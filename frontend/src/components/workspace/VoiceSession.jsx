import { useEffect, useRef, useState } from 'react'
import api from '../../api/client'

function closeConnection(connection) {
  if (!connection) return
  connection.abort?.abort()
  connection.stream?.getTracks().forEach((track) => track.stop())
  connection.channel?.close()
  connection.peer?.close()
  if (connection.audio) connection.audio.srcObject = null
}

export default function VoiceSession({ clientId, clientName, onTranscriptChange, onStatusChange }) {
  const connection = useRef(null)
  const mounted = useRef(true)
  const [status, setStatus] = useState('idle')
  const [muted, setMuted] = useState(false)
  const [paused, setPaused] = useState(false)
  const [transcript, setTranscript] = useState([])
  const [error, setError] = useState('')
  const responding = useRef(false)

  useEffect(() => { onTranscriptChange?.(transcript) }, [transcript, onTranscriptChange])
  useEffect(() => { onStatusChange?.(status) }, [status, onStatusChange])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      closeConnection(connection.current)
      connection.current = null
    }
  }, [])

  function updateTranscript(key, role, value, append = false) {
    setTranscript((current) => {
      const index = current.findIndex((entry) => entry.key === key)
      if (index < 0) return [...current, { key, role, content: value }]
      const next = [...current]
      next[index] = { ...next[index], content: append ? next[index].content + value : value }
      return next
    })
  }

  function onEvent(raw) {
    let event
    try { event = JSON.parse(raw) } catch { return }
    if (event.type === 'conversation.item.input_audio_transcription.delta') {
      updateTranscript(event.item_id, 'You', event.delta || '', true)
    } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
      updateTranscript(event.item_id, 'You', event.transcript || '')
    } else if (event.type === 'response.output_audio_transcript.delta') {
      updateTranscript(`${event.response_id}:${event.item_id || event.output_index}`, 'Ask HealthFlow', event.delta || '', true)
    } else if (event.type === 'response.created') {
      responding.current = true
    } else if (event.type === 'response.done') {
      responding.current = false
    } else if (event.type === 'error') {
      setError('Voice encountered a connection error. End this session and try again.')
    }
  }

  async function start() {
    if (connection.current) return
    setStatus('connecting')
    setError('')
    setTranscript([])
    const local = { peer: null, channel: null, stream: null, audio: null, abort: new AbortController() }
    connection.current = local
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access requires a secure browser connection.')
      local.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mounted.current || connection.current !== local) return
      const token = await api.post('/ask-healthflow/voice/session', { client_id: clientId || null })
      if (!mounted.current || connection.current !== local) return
      local.peer = new RTCPeerConnection()
      local.audio = new Audio()
      local.audio.autoplay = true
      local.peer.ontrack = (event) => {
        local.audio.srcObject = event.streams[0]
        local.audio.play().catch(() => setError('Select play in your browser to hear answers.'))
      }
      local.stream.getAudioTracks().forEach((track) => local.peer.addTrack(track, local.stream))
      local.channel = local.peer.createDataChannel('oai-events')
      local.channel.onmessage = (event) => onEvent(event.data)
      local.channel.onopen = () => { if (mounted.current) setStatus('active') }
      local.peer.onconnectionstatechange = () => {
        if (['failed', 'disconnected', 'closed'].includes(local.peer.connectionState) && connection.current === local) {
          closeConnection(local)
          connection.current = null
          if (mounted.current) setStatus('idle')
        }
      }
      const offer = await local.peer.createOffer()
      await local.peer.setLocalDescription(offer)
      if (!mounted.current || connection.current !== local) return
      const response = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.client_secret}`, 'Content-Type': 'application/sdp' },
        body: offer.sdp,
        signal: local.abort.signal,
      })
      if (!mounted.current || connection.current !== local) return
      if (!response.ok) throw new Error('Voice could not connect. Try again.')
      const sdp = await response.text()
      if (!mounted.current || connection.current !== local) return
      await local.peer.setRemoteDescription({ type: 'answer', sdp })
    } catch (err) {
      const stillCurrent = connection.current === local
      closeConnection(local)
      if (stillCurrent) connection.current = null
      if (mounted.current && stillCurrent) {
        setStatus('idle')
        setError(err.name === 'NotAllowedError' ? 'Microphone permission was denied.' : err.message)
      }
    } finally {
      if (connection.current !== local) closeConnection(local)
    }
  }

  function end() {
    closeConnection(connection.current)
    connection.current = null
    responding.current = false
    setStatus('idle')
    setMuted(false)
    setPaused(false)
  }

  function toggleMute() {
    const next = !muted
    connection.current?.stream?.getAudioTracks().forEach((track) => { track.enabled = !next && !paused })
    setMuted(next)
  }

  function togglePause() {
    const next = !paused
    connection.current?.stream?.getAudioTracks().forEach((track) => { track.enabled = !next && !muted })
    if (connection.current?.audio) {
      if (next) connection.current.audio.pause()
      else connection.current.audio.play().catch(() => setError('Audio playback needs a browser action.'))
    }
    setPaused(next)
  }

  function interrupt() {
    const channel = connection.current?.channel
    if (channel?.readyState === 'open') {
      if (responding.current) channel.send(JSON.stringify({ type: 'response.cancel' }))
      channel.send(JSON.stringify({ type: 'output_audio_buffer.clear' }))
    }
  }

  return <section className="card card-pad ask-voice" aria-label="Voice Session">
    <h2>Voice Session</h2>
    <p className="muted">Start voice when you are ready. Audio and the live transcript stay temporary.</p>
    <p className="ask-voice-context">Active context: {clientName || 'No Client selected'}</p>
    <div className="ask-voice-controls">
      {status === 'idle' ? <button type="button" className="btn" onClick={start}>Start voice</button> : <>
        <span className={`ask-mic-indicator ${!muted && !paused ? 'on' : ''}`} role="status">Microphone {!muted && !paused ? 'on' : 'off'}</span>
        <button type="button" className="btn sm" disabled={status !== 'active'} onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>
        <button type="button" className="btn sm" disabled={status !== 'active'} onClick={togglePause}>{paused ? 'Resume' : 'Pause'}</button>
        <button type="button" className="btn sm" disabled={status !== 'active'} onClick={interrupt}>Interrupt answer</button>
        <button type="button" className="btn sm" onClick={end}>End session</button>
      </>}
    </div>
    {status === 'connecting' && <p role="status">Connecting voice…</p>}
    {error && <p role="alert" className="ask-error">{error}</p>}
    <div className="ask-voice-transcript" role="log" aria-live="polite" aria-label="Live voice transcript">
      {transcript.map((entry) => <p key={entry.key}><strong>{entry.role}:</strong> {entry.content}</p>)}
    </div>
  </section>
}
