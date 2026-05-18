import { useEffect, useMemo, useState } from 'react'

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
  target: {
    tweetId: string | null
    url: string | null
    label: string | null
    text: string | null
    authorHandle: string | null
    authorName: string | null
  } | null
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
    return (
      <main className="shell">
        <div className="card error">{error ?? 'Could not load review items.'}</div>
      </main>
    )
  }

  if (!currentItem) {
    return (
      <main className="shell">
        <div className="card">No review items found.</div>
      </main>
    )
  }

  const completedCount = items.length - remainingCount

  return (
    <main className="shell">
      <section className="card header-card">
        <div>
          <p className="eyebrow">X review app</p>
          <h1>{remainingCount} remaining</h1>
          <p className="subtle">
            {completedCount} reviewed out of {items.length}. Dataset generated {new Date(dataset.generatedAt).toLocaleString()}.
          </p>
        </div>
        <button className="secondary-button" onClick={exportComments} type="button">
          Export comments
        </button>
      </section>

      <section className="card progress-card">
        <div className="progress-row">
          <span>
            Item {currentIndex + 1} / {items.length}
          </span>
          <span>{currentItem.type === 'reply' ? 'Reply' : 'Tweet'}</span>
        </div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${(completedCount / items.length) * 100}%` }} />
        </div>
      </section>

      <section className="card item-card">
        <div className="meta-grid">
          <div>
            <span className="meta-label">Sent at</span>
            <div>{new Date(currentItem.createdAt).toLocaleString()}</div>
          </div>
          <div>
            <span className="meta-label">Link</span>
            <div>
              <a href={currentItem.statusUrl} rel="noreferrer" target="_blank">
                open post
              </a>
            </div>
          </div>
        </div>

        {currentItem.target && (
          <div className="target-card">
            <div className="target-header">Replying to</div>
            <div className="target-handle">
              {currentItem.target.authorHandle ? `@${currentItem.target.authorHandle}` : currentItem.target.label ?? 'unknown'}
            </div>
            {currentItem.target.text ? (
              <blockquote>{currentItem.target.text}</blockquote>
            ) : (
              <p className="subtle">Target tweet text unavailable, but the source link is included below.</p>
            )}
            {currentItem.target.url && (
              <a href={currentItem.target.url} rel="noreferrer" target="_blank">
                open original tweet
              </a>
            )}
          </div>
        )}

        <div className="content-block">
          <div className="content-label">Sent text</div>
          <p>{currentItem.text}</p>
        </div>

        {currentItem.quotedText && (
          <div className="quoted-block">
            <div className="content-label">Quoted text</div>
            <p>{currentItem.quotedText}</p>
          </div>
        )}
      </section>

      <section className="card form-card">
        <label className="content-label" htmlFor="comment-box">
          Comment
        </label>
        <textarea
          id="comment-box"
          onChange={(event) => setDraft(event.target.value)}
          placeholder="What was good or bad here?"
          rows={8}
          value={draft}
        />
        <div className="form-actions">
          <button className="secondary-button" onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} type="button">
            Previous
          </button>
          <button className="primary-button" onClick={handleSubmit} type="button">
            Save and next
          </button>
        </div>
      </section>
    </main>
  )
}

export default App
