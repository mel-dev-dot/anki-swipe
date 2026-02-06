import React, { useEffect, useMemo, useRef, useState } from "react";
import { DECKS as FALLBACK_DECKS } from "./data/japanese.js";

const API_BASE = "http://localhost:3001/api";
const REVIEW_INTERVALS = [1, 2, 4, 7, 14, 30];
const JLPT_LEVELS = ["N5", "N4", "N3", "N2", "N1"];

const now = () => Date.now();

const shuffleList = (list) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const formatNextReview = (dueAt) => {
  if (!dueAt) return "";
  const diffMs = new Date(dueAt).getTime() - now();
  if (diffMs <= 0) return "Now";
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hrs`;
  const days = Math.round(hours / 24);
  return `${days} days`;
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

const highlightKanji = (sentence, kanji) => {
  if (!sentence || !kanji) return sentence || "";
  const index = sentence.indexOf(kanji);
  if (index === -1) return sentence;
  return (
    sentence.slice(0, index) +
    `<span class="kanji-highlight">${kanji}</span>` +
    sentence.slice(index + kanji.length)
  );
};

const ExampleSentence = ({ example, kanji }) => {
  if (!example) return null;

  return (
    <div className="example">
      <div
        className="example-jp"
        dangerouslySetInnerHTML={{
          __html: highlightKanji(example.sentence, kanji),
        }}
      />
      <div className="example-reading">
        <div className="label">Reading</div>
        <div>{example.reading}</div>
        {example.readingReason && (
          <div className="note">{example.readingReason}</div>
        )}
      </div>
      <div className="example-romaji">{example.romaji}</div>
      <div className="example-translation">{example.translation}</div>
      {example.breakdown?.length ? (
        <div className="breakdown">
          <div className="label">Breakdown</div>
          <div className="breakdown-grid">
            {example.breakdown.map((item, index) => (
              <div key={`${item.jp}-${index}`} className="breakdown-item">
                <div className="jp">{item.jp}</div>
                <div className="romaji">{item.romaji}</div>
                <div className="meaning">{item.meaning}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {example.grammarNotes?.length ? (
        <div className="grammar">
          <div className="label">Grammar notes</div>
          <ul>
            {example.grammarNotes.map((note, index) => (
              <li key={`${note}-${index}`}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

const splitRomaji = (romaji) => {
  if (!romaji) return { on: "", kun: "" };
  const parts = romaji.split("/");
  const on = parts[0]?.trim() ?? "";
  const kun = parts.slice(1).join("/").trim();
  return { on, kun };
};

const LearnCard = ({ card, onNext }) => {
  if (!card) return null;
  const { on, kun } = splitRomaji(card.romaji);
  const [isSwiping, setIsSwiping] = useState(false);

  useEffect(() => {
    setIsSwiping(false);
  }, [card?.id]);

  const handleNext = () => {
    setIsSwiping(true);
    window.setTimeout(() => {
      setIsSwiping(false);
      onNext();
    }, 220);
  };

  return (
    <div className="learn-shell">
      <div
        className={`learn-card ${isSwiping ? "is-swiping" : ""}`}
        onClick={handleNext}
        role="button"
        tabIndex={0}
      >
        <div className="learn-header">
          <div className="kanji-glyph">{card.script}</div>
          <div className="kanji-meta">
            <div className="meaning">{card.meaning}</div>
            <div className="reading">
              On: {card.onyomi} {on ? `(${on})` : ""}
            </div>
            <div className="reading">
              Kun: {card.kunyomi} {kun ? `(${kun})` : ""}
            </div>
          </div>
        </div>
        <ExampleSentence example={card.example} kanji={card.script} />
        <button className="next-fab" onClick={handleNext} aria-label="Next kanji">
          →
        </button>
      </div>
      <div className="learn-actions">
        <span className="learn-hint">Tap card or press Next</span>
      </div>
    </div>
  );
};

const SwipeCard = ({
  card,
  onAnswer,
  onReveal,
  answerReady,
  onSkip,
  reviewSettings,
  nextReviewHint,
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
      if (event.key === "1") onAnswer(2);
      if (event.key === "2") onAnswer(3);
      if (event.key === "3") onAnswer(4);
      if (event.key === "4") onAnswer(5);
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
    if (offset.x > 120) onAnswer(4);
    else if (offset.x < -120) onAnswer(2);
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
          <div className="card-stack">
            <div className={`card-prompt ${answerReady ? "hidden" : ""}`}>
              {card?.deck === "kanji" ? "Meaning + Readings" : "Say the sound"}
            </div>
            <div className={`card-details ${answerReady ? "visible" : ""}`}>
              {card?.deck === "kanji" && (
                <>
                  <div className="detail meaning">{card.meaning}</div>
                  {reviewSettings?.showOn && (
                    <div className="detail-line">
                      <span className="detail-label">On:</span> {card.onyomi}
                    </div>
                  )}
                  {reviewSettings?.showKun && (
                    <div className="detail-line">
                      <span className="detail-label">Kun:</span> {card.kunyomi}
                    </div>
                  )}
                  {reviewSettings?.showRomaji && card.romaji && (
                    <div className="detail-line romaji">{card.romaji}</div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="card-actions">
        <button className="ghost" onClick={onReveal}>
          {answerReady ? "Hide" : "Reveal"}
        </button>
        <button className="danger" disabled={!answerReady} onClick={() => onAnswer(2)}>
          Again
        </button>
        <button className="warn" disabled={!answerReady} onClick={() => onAnswer(3)}>
          Hard
        </button>
        <button className="success" disabled={!answerReady} onClick={() => onAnswer(4)}>
          Good
        </button>
        <button className="easy" disabled={!answerReady} onClick={() => onAnswer(5)}>
          Easy
        </button>
      </div>
      {answerReady && nextReviewHint ? (
        <div className="card-hint">Next review in: {nextReviewHint}</div>
      ) : null}
      <div className="card-meta">
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
  const [learnedCards, setLearnedCards] = useState([]);
  const [view, setView] = useState("learn");
  const [learnStep, setLearnStep] = useState("intro");
  const [reviewStep, setReviewStep] = useState("hub");
  const [reviewDeckId, setReviewDeckId] = useState("kanji");
  const [learnLevel, setLearnLevel] = useState("N5");
  const [learnError, setLearnError] = useState("");
  const [lifecycleLevels, setLifecycleLevels] = useState(JLPT_LEVELS);
  const [lifecycleTab, setLifecycleTab] = useState("toLearn");
  const [lifecycleData, setLifecycleData] = useState({
    toLearn: [],
    learning: [],
    mastered: [],
    suggestion: null,
  });
  const [settings, setSettings] = useState({
    newPerSession: 10,
    reviewLimit: 10,
    showOn: true,
    showKun: true,
    showRomaji: true,
  });
  const [sessionIndex, setSessionIndex] = useState(0);
  const [reveal, setReveal] = useState(false);
  const [sessionSeen, setSessionSeen] = useState(new Set());
  const [sessionCards, setSessionCards] = useState([]);
  const [sessionStartedAt, setSessionStartedAt] = useState(now());
  const [reviewAnswered, setReviewAnswered] = useState(0);
  const [reviewResults, setReviewResults] = useState([]);
  const [learningReturn, setLearningReturn] = useState(null);
  const [learningMode, setLearningMode] = useState("normal");
  const [autoLevel, setAutoLevel] = useState(true);
  const [nextReviewHint, setNextReviewHint] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const deckData = await fetchJSON("/decks");
        setDecks(deckData);
        const reviewData = await fetchJSON("/review");
        setReviewCards(mapReviewCards(reviewData));
        const learned = await fetchJSON("/kanji/learned");
        setLearnedCards(learned);
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

  const refreshLearned = async () => {
    try {
      const learned = await fetchJSON("/kanji/learned");
      setLearnedCards(learned);
    } catch (error) {
      setLearnedCards([]);
    }
  };

  useEffect(() => {
    if (view !== "library") return;
    const loadLifecycle = async () => {
      try {
        const levelsParam = lifecycleLevels.length
          ? lifecycleLevels.join(",")
          : "";
        const data = await fetchJSON(`/kanji/lifecycle?levels=${levelsParam}`);
        setLifecycleData(data);
      } catch (error) {
        setLifecycleData({
          toLearn: [],
          learning: [],
          mastered: [],
          suggestion: null,
        });
      }
    };
    loadLifecycle();
  }, [view, lifecycleLevels]);

  const startLearningSession = (cards, index = 0, mode = "normal") => {
    setSessionCards([...cards]);
    setSessionIndex(index);
    setSessionSeen(new Set());
    setSessionStartedAt(now());
    setReveal(false);
    setLearningMode(mode);
  };

  const startReviewSession = (cards, { shuffle = false } = {}) => {
    const list = shuffle ? shuffleList(cards) : [...cards];
    setSessionCards(list);
    setSessionIndex(0);
    setSessionSeen(new Set());
    setSessionStartedAt(now());
    setReveal(false);
    setReviewAnswered(0);
    setReviewResults([]);
  };
  const loadKanjiLesson = async () => {
    try {
      let level = learnLevel;
      if (autoLevel) {
        const levels = JLPT_LEVELS;
        for (const candidate of levels) {
          const probe = await fetchJSON(`/kanji/learn?limit=1&level=${candidate}`);
          if (probe.length) {
            level = candidate;
            setLearnLevel(candidate);
            break;
          }
        }
      }

      const primary = await fetchJSON(
        `/kanji/learn?limit=${settings.newPerSession}&level=${level}`
      );
      let cards = [...primary];
      if (cards.length < settings.newPerSession) {
        const missing = settings.newPerSession - cards.length;
        const fallback = await fetchJSON(`/kanji/learn?limit=${missing}`);
        const existing = new Set(cards.map((card) => card.id));
        cards = [...cards, ...fallback.filter((card) => !existing.has(card.id))];
      }
      if (!cards.length) {
        setLearnError(`No kanji available for ${learnLevel} yet.`);
        setLearnStep("complete");
        return;
      }
      setLearnError("");
      startLearningSession(cards);
      setLearnStep("session");
    } catch (error) {
      setLearnError("Could not load kanji lesson. Is the server running?");
      setLearnStep("complete");
    }
  };

  const onStartReview = async (targetDeckId = "kanji") => {
    setReviewDeckId(targetDeckId);
    try {
      const query = targetDeckId ? `deckId=${targetDeckId}` : "";
      const params = new URLSearchParams(query ? { deckId: targetDeckId } : {});
      params.set("limit", settings.reviewLimit);
      const dueCards = await fetchJSON(`/review/due?${params.toString()}`);
      if (!dueCards.length) {
        setReviewStep("empty");
        return;
      }
      startReviewSession(dueCards, { shuffle: true });
      setReviewStep("session");
    } catch (error) {
      setReviewStep("empty");
    }
  };

  const onAnswer = async (rating) => {
    const card = sessionCards[sessionIndex];
    if (!card) return;
    const answerMs = now() - sessionStartedAt;
    const isCorrect = rating >= 3;

    setReviewAnswered((prev) => Math.min(prev + 1, sessionCards.length));
    setReviewResults((prev) => [...prev, { id: card.id, correct: isCorrect, viewed: false }]);

    try {
      const updated = await fetchJSON("/review/answer", {
        method: "POST",
        body: JSON.stringify({
          cardId: card.id,
          isCorrect,
          rating,
          answerMs,
        }),
      });
      setReviewCards((prev) => ({ ...prev, [updated.cardId]: updated }));
      setNextReviewHint(formatNextReview(updated.dueAt));
      setSessionCards((prev) => {
        const next = [...prev];
        if (next[sessionIndex]) {
          next[sessionIndex] = { ...next[sessionIndex], review: updated };
        }
        return next;
      });
    } catch (error) {
      // ignore for now
    }

    setSessionStartedAt(now());
    setReveal(false);
    setNextReviewHint("");
    if (sessionIndex + 1 >= sessionCards.length) {
      setReviewStep("complete");
      return;
    }
    setSessionIndex((prev) => prev + 1);
  };

  const onReveal = () => setReveal((prev) => !prev);

  const onSkip = () => {
    setReveal(false);
    setReviewAnswered((prev) => Math.min(prev + 1, sessionCards.length));
    const card = sessionCards[sessionIndex];
    if (card) {
      setReviewResults((prev) => [...prev, { id: card.id, correct: false, viewed: false }]);
    }
    if (sessionIndex + 1 >= sessionCards.length) {
      setReviewStep("complete");
      return;
    }
    setSessionIndex((prev) => prev + 1);
    setSessionStartedAt(now());
  };

  const onLearnNext = async () => {
    const card = sessionCards[sessionIndex];
    if (!card) return;

    if (learningMode === "normal") {
      setSessionSeen((prev) => {
        const next = new Set(prev);
        next.add(card.id);
        return next;
      });

      try {
        await fetchJSON("/review/add-cards", {
          method: "POST",
          body: JSON.stringify({ cardIds: [card.id] }),
        });
        refreshReview();
        refreshLearned();
      } catch (error) {
        // ignore for now
      }
    }

    if (sessionIndex + 1 >= sessionCards.length) {
      if (learningMode === "results") {
        setView("review");
        setReviewStep("complete");
        setLearnStep("intro");
        setLearningMode("normal");
        return;
      }
      setLearnStep("complete");
      return;
    }
    setSessionIndex((prev) => prev + 1);
  };

  const seedAllToReview = () =>
    fetchJSON("/review/seed", { method: "POST" })
      .then(() => {
        refreshReview();
        refreshLearned();
      })
      .catch(() => {});

  const resetProgress = () =>
    fetchJSON("/progress/reset", { method: "POST" })
      .then(() => {
        refreshReview();
        refreshLearned();
        setLearnError("");
        setLearnStep("intro");
      })
      .catch(() => {});

  const kanjiDeck = decks.find((deck) => deck.id === "kanji");

  const dueCount = useMemo(
    () => getDueCards(reviewCards, reviewDeckId).length,
    [reviewCards, reviewDeckId]
  );

  const globalDue = useMemo(
    () => getDueCards(reviewCards, "kanji").length,
    [reviewCards]
  );

  const learnProgress = useMemo(() => {
    if (!sessionCards.length) return 0;
    return (sessionIndex / sessionCards.length) * 100;
  }, [sessionCards.length, sessionIndex]);

  const reviewProgress = useMemo(() => {
    if (!sessionCards.length) return 0;
    return (reviewAnswered / sessionCards.length) * 100;
  }, [sessionCards.length, reviewAnswered]);

  const levelStats = useMemo(() => {
    const levels = lifecycleLevels.length ? lifecycleLevels : JLPT_LEVELS;
    return levels.map((level) => {
      const total =
        lifecycleData.toLearn.filter((card) => card.level === level).length +
        lifecycleData.learning.filter((card) => card.level === level).length +
        lifecycleData.mastered.filter((card) => card.level === level).length;
      const mastered = lifecycleData.mastered.filter((card) => card.level === level).length;
      const percent = total ? Math.round((mastered / total) * 100) : 0;
      return { level, total, mastered, percent };
    });
  }, [lifecycleData, lifecycleLevels]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">Kanji-first learning</p>
          <h1>Kanji in Real Sentences</h1>
          {apiStatus === "error" && (
            <p>API offline — using local decks only.</p>
          )}
        </div>
        <div className="tabs">
          <button
            className={`tab ${view === "learn" ? "active" : ""}`}
            onClick={() => {
              setView("learn");
              setLearnStep("intro");
              refreshLearned();
            }}
          >
            Learn
          </button>
          <button
            className={`tab ${view === "review" ? "active" : ""}`}
            onClick={() => {
              setView("review");
              setReviewStep("hub");
              setReviewDeckId("kanji");
            }}
          >
            Anki Review
          </button>
          <button
            className={`tab ${view === "library" ? "active" : ""}`}
            onClick={() => {
              setView("library");
              setLifecycleTab("toLearn");
            }}
          >
            Kanji Path
          </button>
          <button
            className={`tab ${view === "settings" ? "active" : ""}`}
            onClick={() => {
              setView("settings");
            }}
          >
            Settings
          </button>
        </div>
      </header>

      {view === "learn" && (
        <section className="panel">
          {learnStep === "intro" && (
            <>
              <div className="panel-title">
                <h2>Learn Kanji in context</h2>
                <div className="panel-actions">
                  <div className="pill">{settings.newPerSession} new kanji</div>
                </div>
              </div>
              <div className="level-inline">
                <span className="level-label">Level</span>
                <button
                  className="level-pill"
                  onClick={() => {
                    setAutoLevel((prev) => !prev);
                  }}
                  title={autoLevel ? "Auto level" : "Manual level"}
                >
                  {autoLevel ? "Auto" : learnLevel}
                </button>
                <button
                  className="level-change"
                  onClick={() => {
                    setAutoLevel(false);
                    setView("settings");
                  }}
                >
                  Change
                </button>
              </div>
              <p>
                Each Kanji is taught inside a real sentence with readings, grammar notes,
                and word-by-word breakdown.
              </p>
              <div className="cta-row">
                <button className="primary" onClick={loadKanjiLesson}>
                  Start learning
                </button>
              </div>
              {learnError && <p>{learnError}</p>}
              <div className="panel-title">
                <h2>Revisit learned Kanji</h2>
              </div>
              {learnedCards.length === 0 ? (
                <p>No learned kanji yet. Start a lesson to build your knowledge base.</p>
              ) : (
                <div className="learned-grid">
                  {[...learnedCards]
                    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999))
                    .map((card) => (
                    <button
                      key={card.id}
                      className="learned-card"
                      onClick={() => {
                        startLearningSession([card]);
                        setLearnStep("session");
                      }}
                    >
                      <span className="learned-kanji">{card.script}</span>
                      <span className="learned-meaning">{card.meaning}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="kana-support">
                <div className="panel-title">
                  <h2>Kana Support</h2>
                </div>
                <p>Use kana as a reading aid while you focus on Kanji.</p>
                <div className="kana-columns">
                  {decks
                    .filter((deck) => deck.id !== "kanji")
                    .map((deck) => (
                      <div key={deck.id} className="kana-block">
                        <div className="tile-title">
                          {deck.id === "hiragana" ? "Hiragana" : "Katakana"}
                        </div>
                        <div className="tile-sub">Reading aid</div>
                        {deck.groups.map((group) => (
                          <div key={group.id} className="kana-group">
                            <div className="kana-row">
                              {group.cards.map((card) => (
                                <span key={card.id} className="kana-char">
                                  <span className="kana-glyph">{card.script}</span>
                                  <span className="kana-romaji">{card.romaji}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                </div>
              </div>
            </>
          )}

          {learnStep === "session" && (
            <>
              <div className="panel-title">
                <h2>Learning session</h2>
                <div className="panel-actions">
                  <button
                    className="ghost"
                    onClick={() => {
                      if (learningReturn) {
                        setView(learningReturn.view);
                        setReviewStep(learningReturn.step);
                        setLearningReturn(null);
                        return;
                      }
                      setLearnStep("intro");
                    }}
                  >
                    Back
                  </button>
                </div>
              </div>
              <LearnCard
                card={sessionCards[sessionIndex]}
                onNext={onLearnNext}
              />
              <div className="banner">
                New Kanji this session: {sessionCards.length}
              </div>
            </>
          )}

          {learnStep === "complete" && (
            <>
              <h2>Session complete</h2>
              <p>Great work. Your learned Kanji were added to review automatically.</p>
              <button className="primary" onClick={loadKanjiLesson}>
                Learn next {settings.newPerSession}
              </button>
            </>
          )}
        </section>
      )}

      {view === "review" && (
        <section className="panel">
          {reviewStep === "hub" && (
            <>
              <div className="panel-title">
                <h2>Kanji review queue</h2>
                <div className="panel-actions">
                  <div className="review-badge">Due now: {globalDue}</div>
                </div>
              </div>
              <div className="grid">
                {decks
                  .filter((deck) => deck.id === "kanji")
                  .map((deck) => (
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
                <button className="primary" onClick={() => onStartReview("kanji")}>
                  Start Review (max 10)
                </button>
              </div>
            </>
          )}

          {reviewStep === "session" && (
            <>
              <div className="review-top">
                <div className="review-progress">
                  <div className="progress-bar thin">
                    <div className="progress-fill" style={{ width: `${reviewProgress}%` }} />
                  </div>
                  <span>{Math.round(reviewProgress)}%</span>
                </div>
              </div>
              <div className="panel-title">
                <h2>Review</h2>
                <div className="panel-actions">
                  <button className="exit" onClick={() => setReviewStep("complete")}>
                    Exit Review
                  </button>
                </div>
              </div>
              <SwipeCard
                card={sessionCards[sessionIndex]}
                onAnswer={onAnswer}
                onReveal={onReveal}
                answerReady={reveal}
                onSkip={onSkip}
                reviewSettings={settings}
                nextReviewHint={nextReviewHint}
              />
            </>
          )}

          {reviewStep === "complete" && (
            <>
              <h2>Review complete</h2>
              <p>Nice work. You cleared this queue.</p>
                <div className="review-complete-actions">
                  <div className="results-title">Results</div>
                </div>
              <div className="result-grid">
                {[...reviewResults]
                  .map((result, index) => {
                    const card = learnedCards.find((item) => item.id === result.id)
                      || sessionCards.find((item) => item.id === result.id);
                    return { result, card, index };
                  })
                  .filter((item) => item.card)
                  .sort((a, b) => (a.card.order ?? 9999) - (b.card.order ?? 9999))
                  .map(({ result, card, index }) => {
                  if (!card) return null;
                  return (
                    <button
                      key={`${result.id}-${index}`}
                      className={`result-card ${result.correct ? "correct" : "incorrect"} ${result.viewed ? "viewed" : ""}`}
                      onClick={() => {
                        const target = learnedCards.find((item) => item.id === result.id) || card;
                        if (!target) return;
                        setReviewResults((prev) =>
                          prev.map((item) =>
                            item.id === result.id ? { ...item, viewed: true } : item
                          )
                        );
                        const ordered = [...reviewResults]
                          .filter((item) => item.id)
                          .map((item) => learnedCards.find((c) => c.id === item.id) || sessionCards.find((c) => c.id === item.id))
                          .filter(Boolean);
                        const startIndex = ordered.findIndex((item) => item.id === target.id);
                        startLearningSession(ordered, Math.max(0, startIndex), "results");
                        setLearningReturn({ view: "review", step: "complete" });
                        setView("learn");
                        setLearnStep("session");
                      }}
                    >
                      <span className="result-kanji">{card.script}</span>
                      <span className="result-meaning">{card.meaning}</span>
                      <span className={`result-status ${result.correct ? "correct" : "incorrect"}`}>
                        {result.correct ? "Correct" : "Incorrect"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {reviewStep === "empty" && (
            <>
              <h2>No cards due yet</h2>
              <p>Learn new Kanji to add cards into the review queue.</p>
              <button className="primary" onClick={() => setReviewStep("hub")}>
                Back to review hub
              </button>
            </>
          )}
        </section>
      )}

      {view === "library" && (
        <section className="panel">
          <div className="library-shell">
            <aside className="library-sidebar">
              <div className="sidebar-title">JLPT Levels</div>
              <div className="level-options">
                {JLPT_LEVELS.map((level) => (
                  <label key={level} className="level-check">
                    <input
                      type="checkbox"
                      checked={lifecycleLevels.includes(level)}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...lifecycleLevels, level]
                          : lifecycleLevels.filter((item) => item !== level);
                        setLifecycleLevels(next);
                      }}
                    />
                    <span>{level}</span>
                  </label>
                ))}
              </div>
            </aside>
            <div className="library-main">
              <div className="library-tabs">
                <button
                  className={`library-tab ${lifecycleTab === "toLearn" ? "active" : ""}`}
                  onClick={() => setLifecycleTab("toLearn")}
                >
                  To Learn
                </button>
                <button
                  className={`library-tab ${lifecycleTab === "learning" ? "active" : ""}`}
                  onClick={() => setLifecycleTab("learning")}
                >
                  Currently Learning
                </button>
                <button
                  className={`library-tab ${lifecycleTab === "mastered" ? "active" : ""}`}
                  onClick={() => setLifecycleTab("mastered")}
                >
                  Mastered
                </button>
              </div>

              <div className="level-summary">
                {levelStats.map((stat) => (
                  <div key={stat.level} className="level-chip">
                    <div className="level-title">{stat.level}</div>
                    <div className="level-percent">{stat.percent}%</div>
                    <div className="level-sub">
                      {stat.mastered}/{stat.total} mastered
                    </div>
                  </div>
                ))}
              </div>

              {lifecycleTab === "toLearn" && lifecycleData.suggestion && (
                <div className="ai-suggestion">
                  <div className="ai-tag">Suggested by AI Tutor</div>
                  <div className="ai-text">{lifecycleData.suggestion.message}</div>
                  {lifecycleData.suggestion.to && (
                    <div className="ai-card">
                      <div className="ai-kanji">{lifecycleData.suggestion.to.script}</div>
                      <div className="ai-meta">
                        <div className="ai-meaning">{lifecycleData.suggestion.to.meaning}</div>
                        <div className="ai-level">{lifecycleData.suggestion.to.level}</div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="library-grid">
                {(lifecycleTab === "toLearn"
                  ? lifecycleData.toLearn
                  : lifecycleTab === "learning"
                    ? lifecycleData.learning
                    : lifecycleData.mastered
                ).map((card) => (
                  <div key={card.id} className={`library-card ${lifecycleTab}`}>
                    <div className="library-kanji">{card.script}</div>
                    <div className="library-meaning">{card.meaning}</div>
                    <div className="library-meta">
                      <span>{card.level}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {view === "settings" && (
        <section className="panel">
          <div className="panel-title">
            <h2>Settings</h2>
          </div>
      <div className="settings">
            <div className="settings-row">
              <label htmlFor="learn-level">Learn level</label>
              <select
                id="learn-level"
                value={learnLevel}
                onChange={(event) => {
                  setLearnLevel(event.target.value);
                  setAutoLevel(false);
                }}
              >
                {JLPT_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-row">
              <label htmlFor="new-per-session">New per session</label>
              <input
                id="new-per-session"
                type="number"
                min={5}
                max={30}
                step={1}
                value={settings.newPerSession}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    newPerSession: Math.max(5, Number(event.target.value || 10)),
                  }))
                }
              />
            </div>
            <div className="settings-row">
              <label htmlFor="review-limit">Review per session</label>
              <input
                id="review-limit"
                type="number"
                min={5}
                max={30}
                step={1}
                value={settings.reviewLimit}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    reviewLimit: Math.max(5, Number(event.target.value || 10)),
                  }))
                }
              />
            </div>
            <div className="settings-row">
              <span>Review shows</span>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.showOn}
                  onChange={(event) =>
                    setSettings((prev) => ({ ...prev, showOn: event.target.checked }))
                  }
                />
                <span>On</span>
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.showKun}
                  onChange={(event) =>
                    setSettings((prev) => ({ ...prev, showKun: event.target.checked }))
                  }
                />
                <span>Kun</span>
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={settings.showRomaji}
                  onChange={(event) =>
                    setSettings((prev) => ({ ...prev, showRomaji: event.target.checked }))
                  }
                />
                <span>Romaji</span>
              </label>
            </div>
            <div className="settings-row">
              <button className="danger" onClick={resetProgress}>
                Reset progress
              </button>
            </div>
            <div className="preview-card">
              <div className="preview-title">Review Preview</div>
              <SwipeCard
                card={{
                  id: "preview",
                  deck: "kanji",
                  script: kanjiDeck?.groups?.[0]?.cards?.[0]?.script || "私",
                  meaning: kanjiDeck?.groups?.[0]?.cards?.[0]?.meaning || "I, private",
                  onyomi: kanjiDeck?.groups?.[0]?.cards?.[0]?.onyomi || "シ",
                  kunyomi: kanjiDeck?.groups?.[0]?.cards?.[0]?.kunyomi || "わたし",
                  romaji: kanjiDeck?.groups?.[0]?.cards?.[0]?.romaji || "shi / watashi",
                }}
                onAnswer={() => {}}
                onReveal={() => {}}
                answerReady={true}
                onSkip={() => {}}
                reviewSettings={settings}
              />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
