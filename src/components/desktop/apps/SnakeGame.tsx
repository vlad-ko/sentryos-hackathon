'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import * as Sentry from '@sentry/nextjs'
import { Play, RotateCcw, Pause, Trophy, Zap } from 'lucide-react'

const GRID_SIZE = 20
const INITIAL_SPEED = 150
const SPEED_INCREMENT = 5
const MIN_SPEED = 60

type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'
type Position = { x: number; y: number }
type GameState = 'idle' | 'playing' | 'paused' | 'gameover'

function randomFood(snake: Position[]): Position {
  let pos: Position
  do {
    pos = {
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_SIZE),
    }
  } while (snake.some(s => s.x === pos.x && s.y === pos.y))
  return pos
}

export function SnakeGame() {
  const [snake, setSnake] = useState<Position[]>([{ x: 10, y: 10 }])
  const [food, setFood] = useState<Position>({ x: 15, y: 10 })
  const [direction, setDirection] = useState<Direction>('RIGHT')
  const [gameState, setGameState] = useState<GameState>('idle')
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(0)
  const [speed, setSpeed] = useState(INITIAL_SPEED)

  const directionRef = useRef<Direction>('RIGHT')
  const gameStartTimeRef = useRef<number>(0)
  const spanRef = useRef<Sentry.Span | null>(null)
  const gameContainerRef = useRef<HTMLDivElement>(null)

  // Load high score from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sentryos-snake-highscore')
    if (saved) setHighScore(parseInt(saved, 10))
  }, [])

  const endGame = useCallback((reason: string) => {
    const duration = Date.now() - gameStartTimeRef.current

    Sentry.logger.warn('Snake game over', {
      reason,
      score,
      durationMs: duration,
      speed,
    })
    Sentry.metrics.count('snake.game_over', 1, { attributes: { reason } })
    Sentry.metrics.distribution('snake.final_score', score)
    Sentry.metrics.distribution('snake.game_duration_ms', duration)

    if (spanRef.current) {
      spanRef.current.setAttributes({
        'snake.final_score': score,
        'snake.death_reason': reason,
        'snake.duration_ms': duration,
        'snake.final_speed': speed,
      })
      spanRef.current.end()
      spanRef.current = null
    }

    if (score > highScore) {
      setHighScore(score)
      localStorage.setItem('sentryos-snake-highscore', String(score))
      Sentry.logger.info('Snake new high score', { score })
      Sentry.metrics.gauge('snake.high_score', score)
    }

    setGameState('gameover')
  }, [score, highScore, speed])

  const startGame = useCallback(() => {
    const initialSnake = [{ x: 10, y: 10 }]
    setSnake(initialSnake)
    setFood(randomFood(initialSnake))
    setDirection('RIGHT')
    directionRef.current = 'RIGHT'
    setScore(0)
    setSpeed(INITIAL_SPEED)
    setGameState('playing')
    gameStartTimeRef.current = Date.now()

    Sentry.logger.info('Snake game started')
    Sentry.metrics.count('snake.game_started')

    const span = Sentry.startInactiveSpan({
      name: 'snake.game_session',
      op: 'game',
      attributes: {
        'snake.grid_size': GRID_SIZE,
        'snake.initial_speed': INITIAL_SPEED,
      },
    })
    spanRef.current = span

    // Focus the container so keyboard events work
    gameContainerRef.current?.focus()
  }, [])

  const togglePause = useCallback(() => {
    if (gameState === 'playing') {
      setGameState('paused')
      Sentry.logger.info('Snake game paused', { score })
    } else if (gameState === 'paused') {
      setGameState('playing')
      Sentry.logger.info('Snake game resumed', { score })
      gameContainerRef.current?.focus()
    }
  }, [gameState, score])

  // Keyboard handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState === 'idle') return

      if (e.key === ' ' || e.key === 'p') {
        e.preventDefault()
        togglePause()
        return
      }

      if (gameState !== 'playing') return

      const keyMap: Record<string, Direction> = {
        ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
        w: 'UP', s: 'DOWN', a: 'LEFT', d: 'RIGHT',
      }

      const newDir = keyMap[e.key]
      if (!newDir) return

      e.preventDefault()

      const opposites: Record<Direction, Direction> = {
        UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT',
      }

      if (opposites[newDir] !== directionRef.current) {
        directionRef.current = newDir
        setDirection(newDir)
      }
    }

    const container = gameContainerRef.current
    if (container) {
      container.addEventListener('keydown', handleKeyDown)
      return () => container.removeEventListener('keydown', handleKeyDown)
    }
  }, [gameState, togglePause])

  // Game loop
  useEffect(() => {
    if (gameState !== 'playing') return

    const interval = setInterval(() => {
      setSnake(prevSnake => {
        const head = { ...prevSnake[0] }

        switch (directionRef.current) {
          case 'UP': head.y -= 1; break
          case 'DOWN': head.y += 1; break
          case 'LEFT': head.x -= 1; break
          case 'RIGHT': head.x += 1; break
        }

        // Wall collision
        if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE) {
          endGame('wall')
          return prevSnake
        }

        // Self collision
        if (prevSnake.some(s => s.x === head.x && s.y === head.y)) {
          endGame('self')
          return prevSnake
        }

        const newSnake = [head, ...prevSnake]

        // Eat food
        if (head.x === food.x && head.y === food.y) {
          const newScore = score + 10
          setScore(newScore)
          setFood(randomFood(newSnake))

          // Speed up every 50 points
          if (newScore % 50 === 0) {
            setSpeed(prev => {
              const newSpeed = Math.max(MIN_SPEED, prev - SPEED_INCREMENT)
              Sentry.logger.info('Snake speed increased', {
                score: newScore,
                newSpeed,
              })
              return newSpeed
            })
          }

          Sentry.metrics.count('snake.food_eaten')

          return newSnake
        }

        // Remove tail (no growth)
        newSnake.pop()
        return newSnake
      })
    }, speed)

    return () => clearInterval(interval)
  }, [gameState, speed, food, score, endGame])

  // Snake body gradient - head is brightest
  const getCellColor = (index: number, total: number) => {
    if (index === 0) return '#7553ff' // head - full blurple
    const ratio = 1 - (index / total) * 0.6
    const r = Math.round(0x75 * ratio)
    const g = Math.round(0x53 * ratio)
    const b = Math.round(0xff * ratio)
    return `rgb(${r}, ${g}, ${b})`
  }

  return (
    <div
      ref={gameContainerRef}
      tabIndex={0}
      className="h-full flex flex-col bg-[#1e1a2a] outline-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#362552] bg-[#2a2438]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Trophy className="w-4 h-4 text-[#ff45a8]" />
            <span className="text-xs text-[#9086a3]">Score:</span>
            <span className="text-sm font-bold text-[#e8e4f0] tabular-nums">{score}</span>
          </div>
          <div className="w-px h-4 bg-[#362552]" />
          <div className="flex items-center gap-1.5">
            <Trophy className="w-4 h-4 text-[#7553ff]" />
            <span className="text-xs text-[#9086a3]">Best:</span>
            <span className="text-sm font-bold text-[#c4b5fd] tabular-nums">{highScore}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-[#ff45a8]" />
          <span className="text-xs text-[#9086a3] tabular-nums">
            {Math.round((1 - (speed - MIN_SPEED) / (INITIAL_SPEED - MIN_SPEED)) * 100)}%
          </span>
        </div>
      </div>

      {/* Game Grid */}
      <div className="flex-1 flex items-center justify-center p-3">
        <div className="relative aspect-square w-full max-w-[400px] max-h-full">
          <div
            className="grid w-full h-full border border-[#362552] rounded bg-[#0f0c14]"
            style={{
              gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
              gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)`,
              gap: '1px',
            }}
          >
            {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, i) => {
              const x = i % GRID_SIZE
              const y = Math.floor(i / GRID_SIZE)
              const snakeIndex = snake.findIndex(s => s.x === x && s.y === y)
              const isFood = food.x === x && food.y === y

              return (
                <div
                  key={i}
                  className="rounded-[1px] transition-colors duration-75"
                  style={{
                    backgroundColor: snakeIndex >= 0
                      ? getCellColor(snakeIndex, snake.length)
                      : isFood
                        ? '#ff45a8'
                        : '#1a1525',
                    boxShadow: snakeIndex === 0
                      ? '0 0 6px #7553ff80'
                      : isFood
                        ? '0 0 6px #ff45a880'
                        : undefined,
                  }}
                />
              )
            })}
          </div>

          {/* Overlays */}
          {gameState === 'idle' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f0c14]/80 rounded">
              <span className="text-3xl mb-2">🐍</span>
              <span className="text-lg font-bold text-[#e8e4f0] mb-1">SentrySnake</span>
              <span className="text-xs text-[#9086a3] mb-4">Arrow keys or WASD to move</span>
              <button
                onClick={startGame}
                className="flex items-center gap-2 px-4 py-2 bg-[#7553ff] hover:bg-[#8c6fff] rounded text-sm font-medium text-white transition-colors"
              >
                <Play className="w-4 h-4" /> Start Game
              </button>
            </div>
          )}

          {gameState === 'paused' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f0c14]/80 rounded">
              <span className="text-lg font-bold text-[#e8e4f0] mb-1">Paused</span>
              <span className="text-xs text-[#9086a3] mb-4">Press Space or P to resume</span>
              <button
                onClick={togglePause}
                className="flex items-center gap-2 px-4 py-2 bg-[#7553ff] hover:bg-[#8c6fff] rounded text-sm font-medium text-white transition-colors"
              >
                <Play className="w-4 h-4" /> Resume
              </button>
            </div>
          )}

          {gameState === 'gameover' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f0c14]/80 rounded">
              <span className="text-lg font-bold text-[#ff45a8] mb-1">Game Over</span>
              <span className="text-2xl font-bold text-[#e8e4f0] mb-1">{score}</span>
              <span className="text-xs text-[#9086a3] mb-4">
                {score >= highScore && score > 0 ? 'New High Score!' : `Best: ${highScore}`}
              </span>
              <button
                onClick={startGame}
                className="flex items-center gap-2 px-4 py-2 bg-[#7553ff] hover:bg-[#8c6fff] rounded text-sm font-medium text-white transition-colors"
              >
                <RotateCcw className="w-4 h-4" /> Play Again
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-[#362552] bg-[#2a2438]">
        <span className="text-[10px] text-[#9086a3]">
          Arrow keys / WASD to move &middot; Space to pause
        </span>
        {gameState === 'playing' && (
          <button
            onClick={togglePause}
            className="p-1 rounded hover:bg-[#362552] transition-colors"
            title="Pause"
          >
            <Pause className="w-3.5 h-3.5 text-[#9086a3]" />
          </button>
        )}
      </div>
    </div>
  )
}
