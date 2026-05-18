import { useEffect, useMemo, useState } from 'react'

type MediaItem = {
  type: string
  url?: string | null
  expandedUrl?: string | null
  displayUrl?: string | null
  videoUrl?: string | null
}

type ThreadTweet = {
  id: string
  authorHandle?: string | null
  authorName?: string | null
  text: string
  createdAt?: string | null
  statusUrl?: string | null
  isQuote?: boolean
  quotedText?: string | null
  media?: MediaItem[]
  replyToTweetId?: string | null
}

type ReviewItem = {
  id: string
  type: 'reply' | 'tweet'
  createdAt: string
  statusUrl: string
  authorHandle: string
  authorName: string
  text: string
  isQuote: boolean
  quotedText: string | null
  media: MediaItem[]
  target: {
    tweetId: string | null
    url: string | null
    label: string | null
    text: string | null
    authorHandle: string | null
    authorName: string | null
    media?: MediaItem[]
  } | null
  thread: ThreadTweet[]
}

type Dataset = {
  generatedAt: string
  screenName: string
  authorName: string
  daysBack: number
  count: number
  counts: Record<string, number>
  items: ReviewItem[]
}

type StoredComment = {
  comment: string
  submittedAt: string
}

const STORAGE_KEY = 'x-review-app-comments-v1'

function formatDate(value?: string | null) {
  if (!value) return ''
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

function MediaGallery({ media }: { media?: MediaItem[] }) {
  if (!media || media.length === 0) return null

  return (
    <div className="media-grid">
      {media.map((item, index) => {
        if (item.type === 'video' || item.type === 'animated_gif') {
          return (
            <div className="media-tile" key={`${item.url ?? item.videoUrl ?? 'video'}-${index}`}>
              {item.videoUrl ? <video controls src={item.videoUrl} /> : item.url ? <img alt="tweet media" src={item.url} /> : null}
            </div>
          )
        }

        return (
          <div className="media-tile" key={`${item.url ?? 'image'}-${index}`}>
            {item.url ? <img alt="tweet media" src={item.url} /> : null}
          </div>
        )
      })}
    </div>
  )
}

function TweetCard({ tweet, highlight }: { tweet: ThreadTweet; highlight?: boolean }) {
  return (
    <article className={`tweet-card${highlight ? ' tweet-card-highlight' : ''}`}>
      <div className="tweet-header">
        <div>
          <div className="tweet-author">{tweet.authorName ?? tweet.authorHandle ?? 'Unknown'}</div>
          <div className="tweet-handle">@{tweet.authorHandle ?? 'unknown'}</div>
        </div>
        <div className="tweet-date">{formatDate(tweet.createdAt)}</div>
      </div>
      <p className="tweet-text">{tweet.text}</p>
      {tweet.quotedText ? (
        <div className="quoted-box">
          <div className="quoted-label">Quoted</div>
          <p>{tweet.quotedText}</p>
        </div>
      ) : null}
      <MediaGallery media={tweet.media} />
      {tweet.statusUrl ? (
        <div className="tweet-actions">
          <a href={tweet.statusUrl} rel="noreferrer" target="_blank">
            open on X
          </a>
        </div>
      ) : null}
    </article>
  )
}

function ThreadPreview({ item }: { item: ReviewItem }) {
  if (item.type === 'reply') {
    const thread = item.thread && item.thread.length > 0
      ? item.thread
      : [
          {
            id: item.target?.tweetId ?? `target-${item.id}`,
            authorHandle: item.target?.authorHandle,
            authorName: item.target?.authorName,
            text: item.target?.text ?? '',
            statusUrl: item.target?.url ?? undefined,
            media: item.target?.media ?? [],
          },
          {
            id: item.id,
            authorHandle: item.authorHandle,
            authorName: item.authorName,
            text: item.text,
            createdAt: item.createdAt,
            statusUrl: item.statusUrl,
            media: item.media,
            quotedText: item.quotedText,
            isQuote: item.isQuote,
          },
        ]

    const hasOwnReplyInThread = thread.some((tweet) => tweet.id === item.id)
    const renderedThread = hasOwnReplyInThread
      ? thread
      : [
          ...thread,
          {
            id: item.id,
            authorHandle: item.authorHandle,
            authorName: item.authorName,
            text: item.text,
            createdAt: item.createdAt,
            statusUrl: item.statusUrl,
            media: item.media,
            quotedText: item.quotedText,
            isQuote: item.isQuote,
          },
        ]

    return (
      <div className="thread-column">
        {renderedThread.map((tweet) => (
          <TweetCard key={tweet.id} highlight={tweet.id === item.id} tweet={tweet} />
        ))}
      </div>
    )
  }

  return (
    <div className="thread-column">
      <TweetCard
        highlight
        tweet={{
          id: item.id,
          authorHandle: item.authorHandle,
          authorName: item.authorName,
          text: item.text,
          createdAt: item.createdAt,
          statusUrl: item.statusUrl,
          quotedText: item.quotedText,
          isQuote: item.isQuote,
          media: item.media,
        }}
      />
    </div>
  )
}

function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [comments, setComments] = useState<Record<string, StoredComment>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        setComments(JSON.parse(stored))
      } catch {
        window.localStorage.removeItem(STORAGE_KEY)
      }
    }
  }, [])

  useEffect(() => {
    fetch('/review-items.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load review items: ${response.status}`)
        return response.json() as Promise<Dataset>
      })
      .then((data) => setDataset(data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!dataset) return
    const firstIncomplete = dataset.items.findIndex((item) => !comments[item.id]?.comment?.trim())
    setCurrentIndex(firstIncomplete === -1 ? 0 : firstIncomplete)
  }, [dataset, comments])

  const items = dataset?.items ?? []
  const currentItem = items[currentIndex]

  const remainingCount = useMemo(
    () => items.filter((item) => !comments[item.id]?.comment?.trim()).length,
    [comments, items],
  )

  useEffect(() => {
    if (!currentItem) {
      setDraft('')
      return
    }
    setDraft(comments[currentItem.id]?.comment ?? '')
  }, [comments, currentItem])

  const saveComments = (next: Record<string, StoredComment>) => {
    setComments(next)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  const moveToNextIncomplete = (startIndex: number) => {
    if (!items.length) return
    for (let index = startIndex + 1; index < items.length; index += 1) {
      if (!comments[items[index].id]?.comment?.trim()) {
        setCurrentIndex(index)
        return
      }
    }
    for (let index = 0; index <= startIndex; index += 1) {
      if (!comments[items[index].id]?.comment?.trim()) {
        setCurrentIndex(index)
        return
      }
    }
    setCurrentIndex(Math.min(startIndex, items.length - 1))
  }

  const handleSubmit = () => {
    if (!currentItem) return
    const nextComments = {
      ...comments,
      [currentItem.id]: {
        comment: draft,
        submittedAt: new Date().toISOString(),
      },
    }
    saveComments(nextComments)
    moveToNextIncomplete(currentIndex)
  }

  const exportComments = () => {
    if (!dataset) return
    const payload = dataset.items
      .filter((item) => comments[item.id])
      .map((item) => ({
        id: item.id,
        type: item.type,
        createdAt: item.createdAt,
        statusUrl: item.statusUrl,
        text: item.text,
        target: item.target,
        thread: item.thread,
        comment: comments[item.id].comment,
        submittedAt: comments[item.id].submittedAt,
      }))
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'x-review-comments.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return <main className="shell"><div className="card">Loading review items...</div></main>
  }

  if (error || !dataset) {
    return <main className="shell"><div className="card error">{error ?? 'Could not load review items.'}</div></main>
  }

  if (!currentItem) {
    return <main className="shell"><div className="card">No review items found.</div></main>
  }

  const completedCount = items.length - remainingCount

  return (
    <main className="shell">
      <section className="card header-card">
        <div>
          <p className="eyebrow">X review app</p>
          <h1>{remainingCount} remaining</h1>
          <p className="subtle">{completedCount} reviewed out of {items.length}. Dataset generated {new Date(dataset.generatedAt).toLocaleString()}.</p>
        </div>
        <button className="secondary-button" onClick={exportComments} type="button">Export comments</button>
      </section>

      <section className="card progress-card">
        <div className="progress-row">
          <span>Item {currentIndex + 1} / {items.length}</span>
          <span>{currentItem.type === 'reply' ? 'Reply' : 'Tweet'}</span>
        </div>
        <div className="progress-bar"><div className="progress-bar-fill" style={{ width: `${(completedCount / items.length) * 100}%` }} /></div>
      </section>

      <section className="split-layout">
        <div className="card left-pane">
          <div className="meta-grid stacked-gap">
            <div>
              <span className="meta-label">Sent at</span>
              <div>{formatDate(currentItem.createdAt)}</div>
            </div>
            <div>
              <span className="meta-label">Open on X</span>
              <div><a href={currentItem.statusUrl} rel="noreferrer" target="_blank">open sent post</a></div>
            </div>
          </div>
          <ThreadPreview item={currentItem} />
        </div>

        <div className="card right-pane">
          <div className="review-summary">
            <div>
              <span className="meta-label">Review target</span>
              <div>{currentItem.type === 'reply' ? 'Reply chain' : 'Tweet'}</div>
            </div>
            <div>
              <span className="meta-label">Author</span>
              <div>@{currentItem.authorHandle}</div>
            </div>
          </div>

          <label className="content-label" htmlFor="comment-box">Comment</label>
          <textarea id="comment-box" onChange={(event) => setDraft(event.target.value)} placeholder="What was good or bad here?" rows={14} value={draft} />
          <div className="form-actions">
            <button className="secondary-button" onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} type="button">Previous</button>
            <button className="primary-button" onClick={handleSubmit} type="button">Save and next</button>
          </div>
        </div>
      </section>
    </main>
  )
}

export default App
