#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import email.utils
import json
import re
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, "/opt/data/skills/social-media/x-web-operator/scripts")
from reply_batch_safe import (  # type: ignore
    build_cookie_header,
    extract_live_bundle_config,
    http_get,
    load_secrets,
    parse_feature_list,
    parse_field_toggle_list,
)
from x_transaction_id import build_transaction_id  # type: ignore

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "public" / "review-items.json"
SECRETS_PATH = Path("/opt/data/home/x-session-secrets.md")
LEDGER_PATH = Path("/opt/data/home/cron_x_reply_ledger.jsonl")
SCREEN_NAME = "geren8te"
DAYS_BACK = 7


def parse_bundle_operation(main_js: str, operation_name: str) -> tuple[str, dict[str, bool], dict[str, bool]]:
    match = re.search(
        rf'queryId:"([^\"]+)",operationName:"{operation_name}".*?featureSwitches:\[(.*?)\],fieldToggles:\[(.*?)\]',
        main_js,
    )
    if not match:
        raise RuntimeError(f"Could not find operation in bundle: {operation_name}")
    query_id = match.group(1)
    features = parse_feature_list(match.group(2))
    field_toggles = parse_field_toggle_list(match.group(3))
    return query_id, features, field_toggles


def clean_text(text: str | None) -> str:
    if not text:
        return ""
    text = text.replace("\r", " ").replace("\n", " ")
    return re.sub(r"\s+", " ", text).strip()


def parse_created_at(raw: str) -> dt.datetime:
    parsed = email.utils.parsedate_to_datetime(raw)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def get_entries(instructions: list[dict]) -> list[dict]:
    entries: list[dict] = []
    for instruction in instructions:
        if "entries" in instruction:
            entries.extend(instruction["entries"])
        elif "entry" in instruction:
            entries.append(instruction["entry"])
    return entries


def tweet_result_from_entry(entry: dict) -> dict | None:
    content = entry.get("content", {})
    item = content.get("itemContent")
    if not item:
        item = content.get("items", [{}])[0].get("item", {}).get("itemContent")
    if not item or item.get("__typename") != "TimelineTweet":
        return None
    result = ((item.get("tweet_results") or {}).get("result")) or {}
    if result.get("__typename") != "Tweet":
        return None
    return result


def extract_media(legacy: dict) -> list[dict]:
    media = ((legacy.get("extended_entities") or {}).get("media") or [])
    out: list[dict] = []
    for item in media:
        media_type = item.get("type") or "photo"
        record = {
            "type": media_type,
            "url": item.get("media_url_https") or item.get("media_url"),
            "expandedUrl": item.get("expanded_url"),
            "displayUrl": item.get("display_url"),
        }
        if media_type in {"video", "animated_gif"}:
            variants = ((item.get("video_info") or {}).get("variants") or [])
            mp4s = [v for v in variants if v.get("content_type") == "video/mp4" and v.get("url")]
            mp4s.sort(key=lambda v: v.get("bitrate", 0), reverse=True)
            if mp4s:
                record["videoUrl"] = mp4s[0].get("url")
        out.append(record)
    return out


def extract_user(result: dict) -> tuple[str | None, str | None]:
    user_info = ((result.get("core") or {}).get("user_results") or {}).get("result") or {}
    core = user_info.get("core") or {}
    return core.get("screen_name"), core.get("name")


def serialize_tweet(result: dict, fallback_text: str | None = None) -> dict:
    legacy = result.get("legacy") or {}
    tweet_id = str(result.get("rest_id") or legacy.get("id_str") or "")
    author_handle, author_name = extract_user(result)
    quoted_text = None
    if result.get("quoted_status_result"):
        quoted_result = result["quoted_status_result"].get("result") or {}
        quoted_legacy = quoted_result.get("legacy") or {}
        quoted_text = clean_text(quoted_legacy.get("full_text") or quoted_legacy.get("text")) or None
    text = clean_text(legacy.get("full_text") or legacy.get("text") or fallback_text)
    return {
        "id": tweet_id,
        "authorHandle": author_handle,
        "authorName": author_name,
        "text": text,
        "createdAt": parse_created_at(legacy["created_at"]).isoformat() if legacy.get("created_at") else None,
        "statusUrl": f"https://x.com/{author_handle or 'i'}/status/{tweet_id}" if tweet_id else None,
        "isQuote": bool(legacy.get("is_quote_status")),
        "quotedText": quoted_text,
        "media": extract_media(legacy),
        "replyToTweetId": legacy.get("in_reply_to_status_id_str"),
    }


def load_ledger_items(threshold: dt.datetime) -> tuple[list[dict], set[str], set[str]]:
    items: list[dict] = []
    posted_ids: set[str] = set()
    target_ids: set[str] = set()
    if not LEDGER_PATH.exists():
        return items, posted_ids, target_ids

    for line in LEDGER_PATH.read_text().splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("status") != "posted":
            continue
        posted_id = str(row.get("posted_reply_id") or "")
        target_id = str(row.get("tweet_id") or "")
        text = clean_text(row.get("text"))
        ts = row.get("ts")
        if not posted_id or not text or ts is None:
            continue
        created_at = dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc)
        if created_at < threshold:
            continue
        posted_ids.add(posted_id)
        if target_id:
            target_ids.add(target_id)
        items.append(
            {
                "id": posted_id,
                "type": "reply",
                "createdAt": created_at.isoformat(),
                "statusUrl": f"https://x.com/{SCREEN_NAME}/status/{posted_id}",
                "authorHandle": SCREEN_NAME,
                "authorName": "Eren Suner",
                "text": text,
                "isQuote": False,
                "quotedText": None,
                "media": [],
                "target": {
                    "tweetId": target_id or None,
                    "url": row.get("url") or (f"https://x.com/i/web/status/{target_id}" if target_id else None),
                    "label": row.get("label"),
                    "text": None,
                    "authorHandle": None,
                    "authorName": None,
                    "media": [],
                },
                "thread": [],
            }
        )

    return items, posted_ids, target_ids


def main() -> None:
    config = extract_live_bundle_config()
    secrets = load_secrets(SECRETS_PATH)

    home_html = config["home_html"]
    main_url = next(
        url
        for url in re.findall(r'https://abs.twimg.com/responsive-web/client-web(?:-legacy)?/[^"\']+\.js', home_html)
        if "/main." in url
    )
    _, main_js, _ = http_get(main_url, headers={"user-agent": "Mozilla/5.0"})

    operations = {
        name: parse_bundle_operation(main_js, name)
        for name in ["UserByScreenName", "UserTweetsAndReplies", "TweetDetail"]
    }

    def call(operation_name: str, variables: dict, referer: str) -> dict:
        query_id, features, field_toggles = operations[operation_name]
        params = urllib.parse.urlencode(
            {
                "variables": json.dumps(variables, separators=(",", ":")),
                "features": json.dumps(features, separators=(",", ":")),
                "fieldToggles": json.dumps(field_toggles, separators=(",", ":")),
            }
        )
        url = f"https://x.com/i/api/graphql/{query_id}/{operation_name}?{params}"
        txid = build_transaction_id(
            "GET",
            url,
            home_html=config["home_html"],
            ondemand_js=config["ondemand_js"],
        )
        headers = {
            "authorization": f"Bearer {config['bearer']}",
            "x-csrf-token": secrets["ct0"],
            "x-twitter-active-user": "yes",
            "x-twitter-auth-type": "OAuth2Session",
            "x-client-transaction-id": txid,
            "cookie": build_cookie_header(secrets),
            "user-agent": "Mozilla/5.0",
            "referer": referer,
        }
        status_code, body, _ = http_get(url, headers=headers)
        if status_code != 200:
            raise RuntimeError(f"{operation_name} failed with status {status_code}: {body[:400]}")
        return json.loads(body)

    user_payload = call("UserByScreenName", {"screen_name": SCREEN_NAME}, f"https://x.com/{SCREEN_NAME}")
    user_result = user_payload["data"]["user"]["result"]
    user_id = user_result["rest_id"]
    user_name = user_result["core"]["name"]

    threshold = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=DAYS_BACK)

    ledger_items, reply_posted_ids, target_ids = load_ledger_items(threshold)

    tweets_by_id: dict[str, dict] = {}
    cursor: str | None = None

    for _ in range(30):
        variables = {
            "userId": user_id,
            "count": 40,
            "includePromotedContent": True,
            "withQuickPromoteEligibilityTweetFields": True,
            "withVoice": True,
            "withV2Timeline": True,
        }
        if cursor:
            variables["cursor"] = cursor
        payload = call(
            "UserTweetsAndReplies",
            variables,
            f"https://x.com/{SCREEN_NAME}/with_replies",
        )
        timeline = payload["data"]["user"]["result"]["timeline"]["timeline"]
        instructions = timeline["instructions"]
        next_cursor = None

        for entry in get_entries(instructions):
            content = entry.get("content", {})
            if content.get("cursorType") == "Bottom":
                next_cursor = content.get("value")

            result = tweet_result_from_entry(entry)
            if not result:
                continue

            legacy = result.get("legacy") or {}
            tweet_id = str(result.get("rest_id") or legacy.get("id_str") or "")
            if not tweet_id or tweet_id in tweets_by_id or tweet_id in reply_posted_ids:
                continue

            created_at_raw = legacy.get("created_at")
            if not created_at_raw:
                continue
            created_at = parse_created_at(created_at_raw)
            if created_at < threshold:
                continue

            payload = serialize_tweet(result)
            tweets_by_id[tweet_id] = {
                **payload,
                "type": "tweet",
                "authorHandle": payload["authorHandle"] or SCREEN_NAME,
                "authorName": payload["authorName"] or user_name,
                "thread": [],
                "target": None,
            }

        if not next_cursor or next_cursor == cursor:
            break
        cursor = next_cursor

    target_cache: dict[str, dict] = {}
    for target_id in sorted(target_ids):
        if not target_id:
            continue
        try:
            payload = call(
                "TweetDetail",
                {
                    "focalTweetId": target_id,
                    "referrer": "tweet",
                    "with_rux_injections": False,
                    "rankingMode": "Relevance",
                    "includePromotedContent": True,
                    "withCommunity": True,
                    "withQuickPromoteEligibilityTweetFields": True,
                    "withBirdwatchNotes": True,
                    "withVoice": True,
                },
                f"https://x.com/i/web/status/{target_id}",
            )
            instructions = payload["data"]["threaded_conversation_with_injections_v2"]["instructions"]
            thread_entries: list[dict] = []
            focal: dict | None = None
            for entry in get_entries(instructions):
                result = tweet_result_from_entry(entry)
                if not result:
                    continue
                serialized = serialize_tweet(result)
                if not serialized["id"]:
                    continue
                thread_entries.append(serialized)
                if serialized["id"] == target_id:
                    focal = serialized
            target_cache[target_id] = {
                "focal": focal,
                "thread": thread_entries,
            }
        except Exception:
            target_cache[target_id] = {"focal": None, "thread": []}

    for item in ledger_items:
        target = item.get("target")
        if not target or not target.get("tweetId"):
            continue
        cached = target_cache.get(target["tweetId"], {"focal": None, "thread": []})
        detail = cached.get("focal") or {}
        target["text"] = detail.get("text")
        target["authorHandle"] = detail.get("authorHandle") or target.get("label")
        target["authorName"] = detail.get("authorName")
        target["media"] = detail.get("media") or []
        item["thread"] = cached.get("thread") or []

    items = ledger_items + list(tweets_by_id.values())
    items.sort(key=lambda item: item["createdAt"] or "")

    output = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "screenName": SCREEN_NAME,
        "authorName": user_name,
        "daysBack": DAYS_BACK,
        "count": len(items),
        "counts": {
            "reply": sum(1 for item in items if item["type"] == "reply"),
            "tweet": sum(1 for item in items if item["type"] == "tweet"),
        },
        "items": items,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False))
    print(f"Wrote {len(items)} items to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
