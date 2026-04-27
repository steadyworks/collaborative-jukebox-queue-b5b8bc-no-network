'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

const API = 'http://localhost:3001'
const WS_URL = 'ws://localhost:3001/ws'

interface Song {
  id: number
  title: string
  artist: string
  added_by: string
  added_at: number
  net_votes: number
}

interface Playback {
  current_song_id: number | null
  is_playing: boolean
  time_remaining: number
  last_updated: number
}

interface State {
  queue: Song[]
  playback: Playback
  skip_votes: number
  user_count: number
}

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export default function Home() {
  const [userName, setUserName] = useState<string | null>(null)
  const [userId, setUserId] = useState<string>('')
  const [nameInput, setNameInput] = useState('')
  const [queue, setQueue] = useState<Song[]>([])
  const [playback, setPlayback] = useState<Playback>({
    current_song_id: null,
    is_playing: false,
    time_remaining: 30,
    last_updated: Date.now() / 1000,
  })
  const [skipVotes, setSkipVotes] = useState(0)
  const [userCount, setUserCount] = useState(0)
  const [userVotes, setUserVotes] = useState<Record<string, number>>({})
  const [displayTimer, setDisplayTimer] = useState(30)
  const [titleInput, setTitleInput] = useState('')
  const [artistInput, setArtistInput] = useState('')

  const wsRef = useRef<WebSocket | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const playbackRef = useRef(playback)
  playbackRef.current = playback

  // Init from localStorage
  useEffect(() => {
    const storedName = localStorage.getItem('jukebox_user_name')
    const storedId = localStorage.getItem('jukebox_user_id') || genId()
    localStorage.setItem('jukebox_user_id', storedId)
    setUserId(storedId)
    if (storedName) setUserName(storedName)
  }, [])

  // Fetch user votes
  const fetchUserVotes = useCallback(async (uid: string) => {
    try {
      const res = await fetch(`${API}/api/votes?user_id=${uid}`)
      const data = await res.json()
      setUserVotes(data)
    } catch {}
  }, [])

  // Timer management
  const startTimer = useCallback((pb: Playback) => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (!pb.is_playing || pb.current_song_id === null) {
      setDisplayTimer(Math.ceil(pb.time_remaining))
      return
    }
    const updateTimer = () => {
      const elapsed = Date.now() / 1000 - pb.last_updated
      const remaining = pb.time_remaining - elapsed
      setDisplayTimer(Math.max(0, Math.ceil(remaining)))
    }
    updateTimer()
    timerRef.current = setInterval(updateTimer, 250)
  }, [])

  // Apply state from WS
  const applyState = useCallback((s: State, uid: string) => {
    setQueue(s.queue)
    setPlayback(s.playback)
    setSkipVotes(s.skip_votes)
    setUserCount(s.user_count)
    startTimer(s.playback)
    fetchUserVotes(uid)
  }, [startTimer, fetchUserVotes])

  // Connect WebSocket
  useEffect(() => {
    if (!userName || !userId) return
    const connect = () => {
      const ws = new WebSocket(`${WS_URL}?user_name=${encodeURIComponent(userName)}`)
      wsRef.current = ws
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'state') applyState(msg.data, userId)
        } catch {}
      }
      ws.onclose = () => {
        setTimeout(connect, 2000)
      }
    }
    connect()
    return () => {
      wsRef.current?.close()
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [userName, userId, applyState])

  const submitName = () => {
    const n = nameInput.trim()
    if (!n) return
    localStorage.setItem('jukebox_user_name', n)
    setUserName(n)
  }

  const addSong = async (e: React.FormEvent) => {
    e.preventDefault()
    const t = titleInput.trim()
    const a = artistInput.trim()
    if (!t || !a) return
    await fetch(`${API}/api/songs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: t, artist: a, added_by: userName }),
    })
    setTitleInput('')
    setArtistInput('')
  }

  const castVote = async (songId: number, voteType: 'up' | 'down') => {
    await fetch(`${API}/api/songs/${songId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, vote: voteType }),
    })
    fetchUserVotes(userId)
  }

  const togglePlayback = async () => {
    await fetch(`${API}/api/playback`, { method: 'POST' })
  }

  const voteSkip = async () => {
    await fetch(`${API}/api/skip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    })
  }

  const clearQueue = async () => {
    await fetch(`${API}/api/queue`, { method: 'DELETE' })
  }

  const currentSong = queue.find((s) => s.id === playback.current_song_id) ?? null
  const queueItems = queue.filter((s) => s.id !== playback.current_song_id)
  const isPlaying = playback.is_playing
  const hasActiveSong = playback.current_song_id !== null

  if (!userName) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <h2 style={{ marginTop: 0 }}>Welcome to Jukebox</h2>
          <p>Enter your display name to get started:</p>
          <input
            data-testid="user-name-input"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitName()}
            placeholder="Your name"
            style={styles.input}
            autoFocus
          />
          <button data-testid="user-name-submit" onClick={submitName} style={styles.btn}>
            Join
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Jukebox</h1>
        <div style={styles.headerRight}>
          <span data-testid="user-count" style={styles.userCount}>
            {userCount} connected
          </span>
          <button data-testid="clear-queue-btn" onClick={clearQueue} style={styles.dangerBtn}>
            Clear Queue
          </button>
        </div>
      </div>

      {/* Now Playing */}
      <div data-testid="now-playing" style={styles.nowPlaying}>
        {currentSong ? (
          <>
            <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 4 }}>NOW PLAYING</div>
            <div
              data-testid={`song-title-${currentSong.id}`}
              style={{ fontSize: 22, fontWeight: 700 }}
            >
              {currentSong.title}
            </div>
            <div
              data-testid={`song-artist-${currentSong.id}`}
              style={{ fontSize: 16, opacity: 0.8 }}
            >
              {currentSong.artist}
            </div>
            <div style={styles.timerRow}>
              <span data-testid="play-timer" style={styles.timer}>
                {displayTimer}
              </span>
              <span style={{ fontSize: 13, opacity: 0.7 }}>s remaining</span>
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                data-testid="play-pause-btn"
                onClick={togglePlayback}
                style={styles.btn}
              >
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              <button
                data-testid="skip-btn"
                onClick={voteSkip}
                style={styles.skipBtn}
              >
                Vote to Skip
              </button>
              <span data-testid="skip-count" style={{ fontSize: 13, opacity: 0.8 }}>
                {skipVotes}/{userCount} votes to skip
              </span>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 4 }}>NOW PLAYING</div>
            <div style={{ fontSize: 18, opacity: 0.5 }}>Nothing playing</div>
            <div style={{ marginTop: 12 }}>
              <button
                data-testid="play-pause-btn"
                onClick={togglePlayback}
                style={styles.btn}
              >
                Play
              </button>
            </div>
          </>
        )}
      </div>

      {/* Add Song Form */}
      <form data-testid="add-song-form" onSubmit={addSong} style={styles.form}>
        <input
          data-testid="song-title-input"
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          placeholder="Song title"
          style={styles.input}
        />
        <input
          data-testid="song-artist-input"
          value={artistInput}
          onChange={(e) => setArtistInput(e.target.value)}
          placeholder="Artist"
          style={styles.input}
        />
        <button data-testid="add-song-btn" type="submit" style={styles.btn}>
          Add Song
        </button>
      </form>

      {/* Queue */}
      <div style={styles.queueSection}>
        <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 18 }}>
          Queue ({queueItems.length})
        </h2>
        {queueItems.length === 0 && (
          <div style={{ opacity: 0.5, textAlign: 'center', padding: 24 }}>
            Queue is empty. Add a song!
          </div>
        )}
        {queueItems.map((song) => {
          const myVote = userVotes[String(song.id)]
          return (
            <div key={song.id} data-testid={`song-${song.id}`} style={styles.songCard}>
              <div style={{ flex: 1 }}>
                <div data-testid={`song-title-${song.id}`} style={{ fontWeight: 600, fontSize: 16 }}>
                  {song.title}
                </div>
                <div data-testid={`song-artist-${song.id}`} style={{ opacity: 0.75, fontSize: 14 }}>
                  {song.artist}
                </div>
                <div style={{ opacity: 0.5, fontSize: 12, marginTop: 2 }}>
                  Added by {song.added_by}
                </div>
              </div>
              <div style={styles.voteArea}>
                <button
                  data-testid={`upvote-${song.id}`}
                  onClick={() => castVote(song.id, 'up')}
                  style={{ ...styles.voteBtn, background: myVote === 1 ? '#4CAF50' : '#333' }}
                >
                  ▲
                </button>
                <span data-testid={`votes-${song.id}`} style={styles.voteCount}>
                  {song.net_votes}
                </span>
                <button
                  data-testid={`downvote-${song.id}`}
                  onClick={() => castVote(song.id, 'down')}
                  style={{ ...styles.voteBtn, background: myVote === -1 ? '#f44336' : '#333' }}
                >
                  ▼
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  modal: {
    background: '#16213e', borderRadius: 12, padding: 32, minWidth: 320,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  },
  page: { maxWidth: 700, margin: '0 auto', padding: '24px 16px' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerRight: { display: 'flex', alignItems: 'center', gap: 12 },
  userCount: {
    background: '#333', borderRadius: 20, padding: '4px 12px', fontSize: 13,
  },
  nowPlaying: {
    background: '#16213e', borderRadius: 12, padding: 20, marginBottom: 16,
    border: '1px solid #0f3460',
  },
  timerRow: { display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 8 },
  timer: { fontSize: 40, fontWeight: 700, color: '#e94560' },
  form: {
    display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20,
    background: '#16213e', borderRadius: 12, padding: 16,
  },
  input: {
    flex: 1, minWidth: 120, padding: '8px 12px', borderRadius: 6,
    border: '1px solid #333', background: '#0f0f1a', color: '#eee', fontSize: 14,
  },
  btn: {
    padding: '8px 18px', borderRadius: 6, border: 'none',
    background: '#e94560', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600,
  },
  dangerBtn: {
    padding: '6px 14px', borderRadius: 6, border: 'none',
    background: '#555', color: '#fff', cursor: 'pointer', fontSize: 13,
  },
  skipBtn: {
    padding: '8px 18px', borderRadius: 6, border: 'none',
    background: '#f9a825', color: '#000', cursor: 'pointer', fontSize: 14, fontWeight: 600,
  },
  queueSection: {
    background: '#16213e', borderRadius: 12, padding: 16,
  },
  songCard: {
    display: 'flex', alignItems: 'center', gap: 12,
    background: '#0f0f1a', borderRadius: 8, padding: '12px 16px', marginBottom: 8,
  },
  voteArea: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 48,
  },
  voteBtn: {
    width: 32, height: 28, borderRadius: 4, border: 'none',
    color: '#fff', cursor: 'pointer', fontSize: 12,
  },
  voteCount: { fontSize: 16, fontWeight: 700, minWidth: 24, textAlign: 'center' },
}
