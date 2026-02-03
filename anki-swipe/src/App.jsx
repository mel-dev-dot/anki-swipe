import React, { useEffect, useMemo, useRef, useState } from "react";
import { DECKS as FALLBACK_DECKS } from "./data/japanese.js";

const API_BASE = "http://localhost:3001/api";
const REVIEW_INTERVALS = [1, 2, 4, 7, 14, 30];

const now = () => Date.now();
const formatMs = (ms) => `${Math.round(ms / 100) / 10}s`;

const shuffleList = (list) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const fetchJSON = async (path, options) => {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
};

const mapReviewCards = (list) =>
  list.reduce((acc, item) => {
    acc[item.cardId] = item;
    return acc;
  }, {});

const isDue = (reviewCard) =>
  new Date(reviewCard.dueAt).getTime() <= now();

const getDueCards = (reviewCards, deckId = null) => {
  const cards = Object.values(reviewCards).filter(isDue);
  if (!deckId) return cards;
  return cards.filter((card) => card.deck === deckId);
};

const CardFace = ({ card }) => {
  if (!card) return null;
  const isKanji = card.deck === "kanji";

  return (
    <div className="card-face">
      <div className="card-script">{card.script}</div>
      <div className="card-prompt">
        {isKanji ? "Meaning + Readings" : "Sound + Shape"}
      </div>
    </div>
  );
};

const LearnCard = ({ card, onNext, onBack, progress }) => {
  if (!card) return null;
  const isKanji = card.deck === "kanji";

  return (
    <div className="learn-shell">
      <div className="learn-card">
        <CardFace card={card} />
        <div className="learn-details">
          {card.romaji && (
            <div className="detail">{card.romaji.toUpperCase()}</div>
          )}
          {isKanji && (
            <>
              <div className="detail">{card.meaning}</div>
              {card.romaji && <div className="detail">Romaji: {card.romaji}</div>}
              <div className="detail">On: {card.onyomi}</div>
              <div className="detail">Kun: {card.kunyomi}</div>
            </>
          )}
          {!isKanji && (
            <div className="detail">Say it out loud, then move on.</div>
          )}
        </div>
      </div>
      <div className="learn-actions">
        <button className="ghost" onClick={onBack}>
          Previous
        </button>
        <button className="primary" onClick={onNext}>
          Next
        </button>
      </div>
      <div className="progress">
        <span>Progress</span>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span>{Math.round(progress)}%</span>
      </div>
    </div>
  );
};

const SwipeCard = ({
  card,
  onAnswer,
  onReveal,
  answerReady,
  stats,
  onSkip,
}) => {
  const startPos = useRef({ x: 0, y: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setOffset({ x: 0, y: 0 });
  }, [card?.id]);

  useEffect(() => {
    const handleKey = (event) => {
      if (!card) return;
      if (event.key === " ") {
        event.preventDefault();
        onReveal();
      }
      if (!answerReady) return;
      if (event.key === "ArrowRight") onAnswer(true);
      if (event.key === "ArrowLeft") onAnswer(false);
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [answerReady, card, onAnswer, onReveal]);

  const onPointerDown = (event) => {
    if (!card) return;
    setDragging(true);
    startPos.current = { x: event.clientX, y: event.clientY };
  };

  const onPointerMove = (event) => {
    if (!dragging) return;
    setOffset({
      x: event.clientX - startPos.current.x,
      y: event.clientY - startPos.current.y,
    });
  };

  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    if (!answerReady) {
      setOffset({ x: 0, y: 0 });
      return;
    }
    if (offset.x > 120) onAnswer(true);
    else if (offset.x < -120) onAnswer(false);
    else setOffset({ x: 0, y: 0 });
  };

  const rotation = offset.x / 12;

  return (
    <div className="card-shell">
      <div
        className={`card ${answerReady ? "can-answer" : "needs-reveal"}`}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg)`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div className="card-face">
          <div className="card-script">{card?.script}</div>
          {answerReady ? (
            <div className="card-details">
              {card?.romaji && (
                <div className="detail">{card.romaji.toUpperCase()}</div>
              )}
              {card?.deck === "kanji" && (
                <>
                  <div className="detail">{card.meaning}</div>
                  {card.romaji && <div className="detail">Romaji: {card.romaji}</div>}
                  <div className="detail">On: {card.onyomi}</div>
                  <div className="detail">Kun: {card.kunyomi}</div>
                </>
              )}
            </div>
          ) : (
            <div className="card-prompt">
              {card?.deck === "kanji" ? "Meaning + Readings" : "Say the sound"}
            </div>
          )}
        </div>
      </div>
      <div className="card-actions">
        <button className="ghost" onClick={onReveal}>
          {answerReady ? "Hide" : "Reveal"}
        </button>
        <button className="danger" disabled={!answerReady} onClick={() => onAnswer(false)}>
          Wrong
        </button>
        <button className="success" disabled={!answerReady} onClick={() => onAnswer(true)}>
          Right
        </button>
      </div>
      <div className="card-meta">
        <div>Seen: {stats?.seen ?? 0}</div>
        <div>Correct: {stats?.correct ?? 0}</div>
        <div>Wrong: {stats?.wrong ?? 0}</div>
        <div>Avg time: {stats?.avgAnswerMs ? formatMs(stats.avgAnswerMs) : "-"}</div>
        <button className="link" onClick={onSkip}>
          Skip
        </button>
      </div>
    </div>
  );
};

export default function App() {
  const [decks, setDecks] = useState(FALLBACK_DECKS);
  const [apiStatus, setApiStatus] = useState("loading");
  const [reviewCards, setReviewCards] = useState({});
  const [view, setView] = useState("learn");
  const [learnStep, setLearnStep] = useState("deck");
  const [reviewStep, setReviewStep] = useState("hub");
  const [deckId, setDeckId] = useState(null);
  const [groupId, setGroupId] = useState(null);
  const [reviewDeckId, setReviewDeckId] = useState(null);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [reveal, setReveal] = useState(false);
  const [sessionSeen, setSessionSeen] = useState(new Set());
  const [sessionCards, setSessionCards] = useState([]);
  const [sessionStartedAt, setSessionStartedAt] = useState(now());

  useEffect(() => {
    const load = async () => {
      try {
        const deckData = await fetchJSON("/decks");
        setDecks(deckData);
        const reviewData = await fetchJSON("/review");
        setReviewCards(mapReviewCards(reviewData));
        setApiStatus("ok");
      } catch (error) {
        setApiStatus("error");
        setDecks(FALLBACK_DECKS);
        setReviewCards({});
      }
    };
    load();
  }, []);

  const refreshReview = async () => {
    const reviewData = await fetchJSON("/review");
    setReviewCards(mapReviewCards(reviewData));
  };

  const startSession = (cards, { shuffle = false } = {}) => {
    const list = shuffle ? shuffleList(cards) : [...cards];
    setSessionCards(list);
    setSessionIndex(0);
    setSessionSeen(new Set());
    setSessionStartedAt(now());
    setReveal(false);
  };

  const onPickDeck = (id) => {
    setDeckId(id);
    setGroupId(null);
    setLearnStep("group");
  };

  const onPickGroup = (id) => {
    setGroupId(id);
    const cards = decks
      .find((deck) => deck.id === deckId)
      ?.groups.find((group) => group.id === id)?.cards;
    if (!cards) return;
    startSession(
      cards.map((card) => ({ ...card, deck: deckId, group: id })),
      { shuffle: false }
    );
    setLearnStep("session");
  };

  const onStartReview = async (targetDeckId = null) => {
    setReviewDeckId(targetDeckId);
    try {
      const query = targetDeckId ? `?deckId=${targetDeckId}` : "";
      const dueCards = await fetchJSON(`/review/due${query}`);
      if (!dueCards.length) {
        setReviewStep("empty");
        return;
      }
      startSession(dueCards, { shuffle: true });
      setReviewStep("session");
    } catch (error) {
      setReviewStep("empty");
    }
  };

  const onAnswer = async (isCorrect) => {
    const card = sessionCards[sessionIndex];
    if (!card) return;
    const answerMs = now() - sessionStartedAt;

    try {
      const updated = await fetchJSON("/review/answer", {
        method: "POST",
        body: JSON.stringify({
          cardId: card.id,
          isCorrect,
          answerMs,
        }),
      });
      setReviewCards((prev) => ({ ...prev, [updated.cardId]: updated }));
    } catch (error) {
      // ignore for now
    }

    setSessionStartedAt(now());
    setReveal(false);
    if (sessionIndex + 1 >= sessionCards.length) {
      setReviewStep("complete");
      return;
    }
    setSessionIndex((prev) => prev + 1);
  };

  const onReveal = () => setReveal((prev) => !prev);

  const onSkip = () => {
    setReveal(false);
    if (sessionIndex + 1 >= sessionCards.length) {
      setReviewStep("complete");
      return;
    }
    setSessionIndex((prev) => prev + 1);
    setSessionStartedAt(now());
  };

  const onLearnNext = () => {
    const card = sessionCards[sessionIndex];
    if (!card) return;
    setSessionSeen((prev) => {
      const next = new Set(prev);
      next.add(card.id);
      return next;
    });
    setSessionIndex((prev) =>
      prev + 1 >= sessionCards.length ? prev : prev + 1
    );
  };

  const onLearnBack = () => {
    setSessionIndex((prev) =>
      prev === 0 ? 0 : prev - 1
    );
  };

  useEffect(() => {
    if (learnStep !== "session") return;
    const currentDeck = decks.find((deck) => deck.id === deckId);
    const group = currentDeck?.groups.find((g) => g.id === groupId);
    if (!group) return;
    if (sessionSeen.size >= group.cards.length) {
      fetchJSON("/review/add-group", {
        method: "POST",
        body: JSON.stringify({ deckId, groupId }),
      })
        .then(refreshReview)
        .catch(() => {});
    }
  }, [learnStep, sessionSeen, decks, groupId, deckId]);

  const seedAllToReview = () =>
    fetchJSON("/review/seed", { method: "POST" })
      .then(refreshReview)
      .catch(() => {});

  const basicsDecks = decks.filter((deck) => deck.id !== "kanji");
  const kanjiDeck = decks.find((deck) => deck.id === "kanji");

  const getStatsForCard = (cardId) => reviewCards[cardId];

  const dueCount = useMemo(
    () => getDueCards(reviewCards, reviewDeckId).length,
    [reviewCards, reviewDeckId]
  );

  const globalDue = useMemo(
    () => getDueCards(reviewCards, null).length,
    [reviewCards]
  );

  const learnProgress = useMemo(() => {
    if (!sessionCards.length) return 0;
    return (sessionSeen.size / sessionCards.length) * 100;
  }, [sessionCards.length, sessionSeen.size]);

  const reviewProgress = useMemo(() => {
    if (!sessionCards.length) return 0;
    return ((sessionIndex + 1) / sessionCards.length) * 100;
  }, [sessionCards.length, sessionIndex]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">Japanese study system</p>
          <h1>Swipe. Learn. Remember.</h1>
          {apiStatus === "error" && (
            <p>API offline — using local decks only.</p>
          )}
        </div>
        <div className="tabs">
          <button
            className={`tab ${view === "learn" ? "active" : ""}`}
            onClick={() => {
              setView("learn");
              setLearnStep("deck");
            }}
          >
            Learn
          </button>
          <button
            className={`tab ${view === "review" ? "active" : ""}`}
            onClick={() => {
              setView("review");
              setReviewStep("hub");
              setReviewDeckId(null);
            }}
          >
            Anki Review
          </button>
        </div>
      </header>

      {view === "learn" && (
        <section className="panel">
          {learnStep === "deck" && (
            <>
              <div className="panel-title">
                <h2>Basics</h2>
                <div className="panel-actions">
                  <div className="pill">Auto-add to review</div>
                </div>
              </div>
              <div className="grid">
                {basicsDecks.map((deck) => (
                  <button key={deck.id} className="tile" onClick={() => onPickDeck(deck.id)}>
                    <div className="tile-title">{deck.label}</div>
                    <div className="tile-sub">Groups: {deck.groups.length}</div>
                  </button>
                ))}
              </div>
              <div className="panel-title">
                <h2>Kanji</h2>
              </div>
              {kanjiDeck && (
                <button className="tile" onClick={() => onPickDeck(kanjiDeck.id)}>
                  <div className="tile-title">{kanjiDeck.label}</div>
                  <div className="tile-sub">Levels: {kanjiDeck.groups.length}</div>
                </button>
              )}
            </>
          )}

          {learnStep === "group" && deckId && (
            <>
              <div className="panel-title">
                <h2>{decks.find((deck) => deck.id === deckId)?.label} learning path</h2>
                <div className="panel-actions">
                  <button className="ghost" onClick={() => setLearnStep("deck")}>
                    Back
                  </button>
                </div>
              </div>
              <div className="grid">
                {decks
                  .find((deck) => deck.id === deckId)
                  ?.groups.map((group) => (
                    <button
                      key={group.id}
                      className="tile"
                      onClick={() => onPickGroup(group.id)}
                      disabled={group.cards.length === 0}
                    >
                      <div className="tile-title">{group.label}</div>
                      <div className={`tile-sub ${group.cards.length ? "status" : ""}`}>
                        {group.cards.length ? "Ready" : "Coming soon"}
                      </div>
                    </button>
                  ))}
              </div>
            </>
          )}

          {learnStep === "session" && (
            <>
              <div className="panel-title">
                <h2>Learning session</h2>
                <div className="panel-actions">
                  <button className="ghost" onClick={() => setLearnStep("group")}>
                    Groups
                  </button>
                </div>
              </div>
              <LearnCard
                card={sessionCards[sessionIndex]}
                onNext={onLearnNext}
                onBack={onLearnBack}
                progress={learnProgress}
              />
              {sessionSeen.size >= sessionCards.length && (
                <div className="banner success">
                  Group complete. Cards added to review automatically.
                </div>
              )}
            </>
          )}
        </section>
      )}

      {view === "review" && (
        <section className="panel">
          {reviewStep === "hub" && (
            <>
              <div className="panel-title">
                <h2>Review queue</h2>
                <div className="panel-actions">
                  <div className="review-badge">Due now: {globalDue}</div>
                </div>
              </div>
              <div className="grid">
                {decks.map((deck) => (
                  <div key={deck.id} className="review-tile">
                    <div>
                      <div className="tile-title">{deck.label}</div>
                      <div className="tile-sub">Due: {getDueCards(reviewCards, deck.id).length}</div>
                    </div>
                    <button className="primary" onClick={() => onStartReview(deck.id)}>
                      Start
                    </button>
                  </div>
                ))}
              </div>
              <div className="panel-actions">
                <button className="ghost" onClick={seedAllToReview}>
                  Seed Review Database
                </button>
                <button className="primary" onClick={() => onStartReview(null)}>
                  Start Review (All)
                </button>
              </div>
            </>
          )}

          {reviewStep === "session" && (
            <>
              <div className="panel-title">
                <h2>Anki review</h2>
                <div className="panel-actions">
                  <button className="ghost" onClick={() => setReviewStep("hub")}>
                    Review Hub
                  </button>
                  <div className="review-badge">Due: {dueCount}</div>
                </div>
              </div>
              <SwipeCard
                card={sessionCards[sessionIndex]}
                onAnswer={onAnswer}
                onReveal={onReveal}
                answerReady={reveal}
                stats={getStatsForCard(sessionCards[sessionIndex]?.id)}
                onSkip={onSkip}
              />
              <div className="progress">
                <span>Session</span>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${reviewProgress}%` }} />
                </div>
                <span>{Math.round(reviewProgress)}%</span>
              </div>
            </>
          )}

          {reviewStep === "complete" && (
            <>
              <h2>Review complete</h2>
              <p>Nice work. You cleared this queue.</p>
              <button className="primary" onClick={() => setReviewStep("hub")}>
                Back to review hub
              </button>
            </>
          )}

          {reviewStep === "empty" && (
            <>
              <h2>No cards due yet</h2>
              <p>Study a group to add cards into the review queue.</p>
              <button className="primary" onClick={() => setReviewStep("hub")}>
                Back to review hub
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
