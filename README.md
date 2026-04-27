# Collaborative Jukebox Queue

Build a real-time shared jukebox — a living queue of songs where anyone who joins the room can add tracks, vote to reorder them, and watch the same music play in sync. No accounts required. Just open the page, pick a name, and start contributing.

## Stack

- **Frontend**: Pure React on port **3000**
- **Backend**: Flask on port **3001**
- **Persistence**: SQLite
- **Real-time**: WebSockets

## Identity

On first visit the app prompts the user for a display name. This name is stored in the browser (e.g. `localStorage` or a cookie) and persists across page refreshes so the user isn't asked again. The name is shown on screen and attached to everything that user does. Multiple browser tabs or separate browsers are treated as separate users.

## The Queue

The queue is a list of songs waiting to be played. Each song has a title, artist, the display name of whoever added it, and a net vote count. The queue is always sorted **descending by net votes**. When two songs share the same net vote count, the one added earlier comes first. The queue reorders itself visually whenever votes change.

### Adding Songs

A form at the top (or a clearly accessible location on the page) lets any user submit a song by entering a title and an artist name. Both fields are required. Submitting the form appends the new song to the bottom of the queue (net votes = 0). The form clears itself after a successful submission.

### Voting

Every song in the queue (excluding the currently playing track) has an upvote button and a downvote button. Each user gets exactly one vote per song — up **or** down, not both. Clicking the same vote button a second time removes the vote (toggle). A user cannot simultaneously hold an upvote and a downvote on the same song; selecting one cancels the other. The net vote count for each song is always visible. Votes persist across page reloads.

## Now Playing

The first song in the sorted queue becomes the "Now Playing" track when playback is active. The now-playing area shows the song's title, artist, and a live countdown timer. For simplicity, every song has a fixed playback duration of **30 seconds**. When the timer hits zero the song is automatically removed from the queue and the next top-voted song takes its place — playback continues uninterrupted as long as songs remain.

### Play / Pause

A prominent Play/Pause toggle controls whether time is advancing. When paused the countdown freezes; no auto-advance occurs. When unpaused the timer resumes from where it stopped.

### Skip Voting

While a song is playing a "Vote to Skip" button is visible to all users. Each user can vote to skip the current song once. When the number of skip votes exceeds half the number of currently connected users, the song is immediately removed and the next song starts playing. The skip vote tally (e.g. `2/4 votes to skip`) is always visible during playback. Skip vote counts reset whenever the playing track changes.

## Clear Queue

A "Clear Queue" button is always visible. Pressing it removes every song from the queue, resets all votes, clears skip votes, and stops playback. The now-playing area returns to an idle/empty state.

## Real-time Sync

Every mutation — song added, vote cast, playback state change, skip vote, queue advance, clear — is broadcast to all connected clients over WebSocket immediately. Clients do not need to poll or reload to see changes made by others.

A live count of currently connected users is shown on the page.

## Persistence

The full queue state (songs, votes, playback position, pause/play state) is stored in SQLite and survives a backend restart. Reloading the page restores the queue, the currently playing song, and approximately where the timer was (small drift is acceptable).

## Page Structure

The app lives on a **single page at `/`**. No other frontend routes are needed.

## `data-testid` Reference

Every interactive and observable element must carry the exact `data-testid` attribute listed below.

### Identity

- `user-name-input` — the text field where the user types their display name on first visit
- `user-name-submit` — the button that confirms the name
- `user-count` — the live count of connected users

### Add Song Form

- `add-song-form` — the `<form>` element wrapping the title and artist inputs
- `song-title-input` — text input for the song title
- `song-artist-input` — text input for the artist name
- `add-song-btn` — the submit button inside the form

### Queue

- `song-{id}` — the container element for each song in the queue, where `{id}` is the song's unique identifier
- `song-title-{id}` — the title text for the song
- `song-artist-{id}` — the artist text for the song
- `votes-{id}` — the net vote count for the song (numeric text)
- `upvote-{id}` — the upvote button for the song
- `downvote-{id}` — the downvote button for the song

### Now Playing

- `now-playing` — the container for the currently playing track (present even when idle/empty)
- `play-timer` — the countdown (text content is the whole number of seconds remaining, e.g. `"30"`, `"29"`, …)

### Controls

- `play-pause-btn` — the Play/Pause toggle button
- `skip-btn` — the Vote to Skip button (visible only during active playback)
- `skip-count` — the skip vote tally, formatted as `"{votes}/{total} votes to skip"`
- `clear-queue-btn` — the Clear Queue button
