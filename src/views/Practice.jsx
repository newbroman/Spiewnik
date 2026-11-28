import React, { useEffect, useRef, useState } from "react";
import { SPLIT_RE, aiCapHit, langOf } from "../lib/util.js";
import { apiHeaders } from "../supabase.js";
import { blobToBase64, grade } from "../lib/practice.js";
import { useT } from "../lib/i18nContext.js";

// ---- Practice ---------------------------------------------------------------
export default function Practice({ song, onBack }) {
  const tr = useT();
  const bcp = langOf(song.language).bcp;
  const lang2 = (bcp || "pl").slice(0, 2);
  const lines = React.useMemo(() => {
    const pl = (song.pl || "").split(SPLIT_RE);
    const en = (song.en || "").split(SPLIT_RE);
    return pl.map((s, i) => ({ pl: s.trim(), en: (en[i] || "").trim() })).filter((l) => l.pl);
  }, [song.id]);
  const [idx, setIdx] = useState(0);
  const [heard, setHeard] = useState("");
  const [score, setScore] = useState(null);
  const [listening, setListening] = useState(false);  // recording (whisper) or recognising (browser)
  const [ready, setReady] = useState(false);          // mic live → "Speak now"
  const [countdown, setCountdown] = useState(null);
  const [processing, setProcessing] = useState(false); // awaiting Whisper transcript
  const [recUrl, setRecUrl] = useState(null);
  const [recording, setRecording] = useState(false);  // browser-mode separate self-recording
  const [showEn, setShowEn] = useState(false);
  const [engine, setEngine] = useState(null);         // "whisper" | "browser" | "none" | null (checking)
  const recRef = useRef(null), mediaRef = useRef(null), streamRef = useRef(null), chunksRef = useRef([]);
  const cdRef = useRef(null), vadRef = useRef(null), capRef = useRef(null), lastTapRef = useRef(0);
  const Rec = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const line = lines[idx];

  // Pick the best available engine: Whisper when the server has a key, else the browser.
  useEffect(() => {
    let ok = true;
    fetch("/api/ai", { headers: apiHeaders() })
      .then((r) => r.json())
      .then((j) => { if (ok) setEngine(j && j.configured ? "whisper" : (Rec ? "browser" : "none")); })
      .catch(() => { if (ok) setEngine(Rec ? "browser" : "none"); });
    return () => { ok = false; };
  }, []);

  const stopAll = () => {
    try { clearInterval(cdRef.current); } catch {}
    try { clearInterval(vadRef.current); } catch {}
    try { clearTimeout(capRef.current); } catch {}
    try { recRef.current?.stop(); } catch {}
    try { if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop(); } catch {}
    try { streamRef.current?.getTracks().forEach((trk) => trk.stop()); } catch {}
  };

  useEffect(() => () => { stopAll(); try { window.speechSynthesis?.cancel(); } catch {} }, []);

  if (!line) return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label="Back">←</button>
        <div className="ttl"><h2>{tr("practice")}</h2><p>{song.title}</p></div>
      </div>
      <div className="prac"><p className="pracnote">{tr("noPracticeYet")}</p></div>
    </>
  );

  const speak = (rate = 0.75) => {
    try {
      const synth = window.speechSynthesis; synth.cancel();
      const u = new SpeechSynthesisUtterance(line.pl);
      u.lang = bcp; u.rate = rate;
      const v = synth.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith(lang2));
      if (v) u.voice = v;
      synth.speak(u);
    } catch {}
  };
  // Single tap = normal; a quick second tap re-plays at half speed.
  const onListen = () => {
    const now = Date.now();
    const dbl = now - lastTapRef.current < 350;
    lastTapRef.current = now;
    speak(dbl ? 0.45 : 0.75);
  };
  const clearRec = () => { if (recUrl) { try { URL.revokeObjectURL(recUrl); } catch {} setRecUrl(null); } };

  // ---- Whisper path: record the line, transcribe the clip, grade it; same clip plays back.
  const startWhisper = async () => {
    setHeard(""); setScore(null); clearRec(); setListening(true); setReady(false);
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setListening(false); return; }
    streamRef.current = stream; chunksRef.current = [];
    const mime = window.MediaRecorder?.isTypeSupported("audio/webm") ? "audio/webm"
      : window.MediaRecorder?.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
    let mr;
    try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
    catch { stream.getTracks().forEach((t) => t.stop()); setListening(false); return; }
    mediaRef.current = mr;
    const chunks = chunksRef.current;
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      try { clearInterval(vadRef.current); } catch {}
      try { clearTimeout(capRef.current); } catch {}
      stream.getTracks().forEach((t) => t.stop());
      setListening(false); setReady(false);
      const blob = new Blob(chunks, { type: mime || "audio/webm" });
      if (!blob.size) return;
      setRecUrl(URL.createObjectURL(blob));
      setProcessing(true);
      try {
        const b64 = await blobToBase64(blob);
        const r = await fetch("/api/ai?op=transcribe", {
          method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() },
          body: JSON.stringify({ audio: b64, mime: mime || "audio/webm", language: lang2 }),
        });
        if (aiCapHit(r, tr)) return;
        const j = await r.json();
        const t = (j.text || "").trim();
        if (t) { setHeard(t); setScore(grade(line.pl, t)); }
      } catch {} finally { setProcessing(false); }
    };
    mr.start(); setReady(true);
    const safeStop = () => { try { if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop(); } catch {} };
    capRef.current = setTimeout(safeStop, 20000); // hard cap
    // Voice-activity detection: stop once the speaker has talked then fallen silent.
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        const ctx = new AC();
        const an = ctx.createAnalyser(); an.fftSize = 2048;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(an.fftSize);
        let spoke = false, silence = 0, el = 0;
        vadRef.current = setInterval(() => {
          an.getByteTimeDomainData(buf);
          let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          const rms = Math.sqrt(sum / buf.length); el += 100;
          if (rms > 0.025) { spoke = true; silence = 0; } else if (spoke) { silence += 100; }
          if (spoke && silence >= 1300 && el >= 600) { try { ctx.close(); } catch {} safeStop(); }
        }, 100);
      }
    } catch {}
  };

  // ---- Browser path: live Web Speech recognition (no recorder, so no mic clash).
  const startBrowser = () => {
    if (!Rec) return;
    setHeard(""); setScore(null); setListening(true); setReady(false);
    const rec = new Rec(); recRef.current = rec;
    rec.lang = bcp; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onstart = () => setReady(true);
    rec.onresult = (e) => { const t = e.results[0][0].transcript; setHeard(t); setScore(grade(line.pl, t)); };
    rec.onerror = () => { setReady(false); };
    rec.onend = () => { setListening(false); setReady(false); };
    try { rec.start(); } catch { setListening(false); setReady(false); }
  };

  // Browser-mode only: a separate recorder so the user can still hear themselves.
  const toggleRecord = async () => {
    if (recording) {
      try { if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop(); } catch {}
      setRecording(false);
      return;
    }
    if (listening || countdown !== null) return;
    clearRec();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream; chunksRef.current = [];
      const mr = new MediaRecorder(stream); mediaRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        try {
          const blob = new Blob(chunksRef.current, { type: mediaRef.current?.mimeType || "audio/webm" });
          if (blob.size) setRecUrl(URL.createObjectURL(blob));
        } catch {}
        try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
      };
      mr.start(); setRecording(true);
    } catch { setRecording(false); }
  };

  const beginListen = () => {
    if (listening || countdown !== null || recording || processing) return;
    setHeard(""); setScore(null);
    let n = 3;
    setCountdown(n);
    cdRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        try { clearInterval(cdRef.current); } catch {}
        setCountdown(null);
        if (engine === "whisper") startWhisper(); else startBrowser();
      } else setCountdown(n);
    }, 750);
  };

  const stopListen = () => {
    try { clearInterval(cdRef.current); } catch {}
    try { recRef.current?.stop(); } catch {}
    try { if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop(); } catch {}
    setCountdown(null); setListening(false); setReady(false);
  };
  const playBack = () => { if (recUrl) { try { const a = new Audio(recUrl); a.play(); } catch {} } };
  const go = (d) => {
    stopAll(); setCountdown(null); setListening(false); setReady(false); setRecording(false); setProcessing(false);
    setHeard(""); setScore(null); setShowEn(false); clearRec();
    setIdx((i) => Math.min(lines.length - 1, Math.max(0, i + d)));
  };

  const canSpeak = engine === "whisper" || (engine === "browser" && Rec);

  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label="Back">←</button>
        <div className="ttl"><h2>{tr("practice")}</h2><p>{song.title} · {idx + 1}/{lines.length}</p></div>
      </div>
      <div className="prac">
        <div className="pracline">
          {score ? score.marks.map((m, i) => <span key={i} className={m.ok ? "wok" : "wno"}>{m.w}{" "}</span>) : line.pl}
        </div>
        {showEn && <div className="pracen">{line.en || "—"}</div>}
        <button className="pracen-toggle" onClick={() => setShowEn((v) => !v)}>{showEn ? tr("hideMeaning") : tr("showMeaning")}</button>
        {(countdown !== null || ready || processing) && (
          <div className={"praccue" + ((ready || processing) ? " live" : "")}>
            {countdown !== null ? countdown : (processing ? tr("checking") : tr("speakNow"))}
          </div>
        )}
        <div className="pracbtns">
          <button className="pracbtn" onClick={onListen}>{tr("listen")}</button>
          {canSpeak && (
            <button className={"pracbtn mic" + (listening ? " on" : "")} onClick={listening ? stopListen : beginListen} disabled={countdown !== null || processing || recording}>
              {countdown !== null ? tr("getReady") : (listening ? tr("listeningStop") : tr("speak"))}
            </button>
          )}
        </div>
        <p className="prachint">{tr("slowHint")}</p>
        {(recUrl || engine === "browser") && (
          <div className="pracbtns">
            {engine === "browser" && (
              <button className={"pracbtn" + (recording ? " on" : "")} onClick={toggleRecord} disabled={listening || countdown !== null || processing}>
                {recording ? tr("recStop") : tr("recSelf")}
              </button>
            )}
            {recUrl && <button className="pracbtn" onClick={playBack}>{tr("hearYourself")}</button>}
          </div>
        )}
        {heard && (
          <div className="pracfb">
            <div className="pracpct" data-good={!!(score && score.pct >= 70)}>{score ? score.pct : 0}% match</div>
            <div className="pracheard">You said: “{heard}”</div>
          </div>
        )}
        {engine === "none" && <p className="pracnote">Speaking feedback needs Chrome or an Android phone. You can still tap Listen and read along.</p>}
        <div className="pracnav">
          <button className="navbtn" onClick={() => go(-1)} disabled={idx === 0}>{tr("prev")}</button>
          <button className="navbtn" onClick={() => go(1)} disabled={idx === lines.length - 1}>{tr("next")}</button>
        </div>
      </div>
    </>
  );
}
