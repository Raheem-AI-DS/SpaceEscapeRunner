import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Dimensions,
  StatusBar,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ================= CONSTANTS =================
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const SHIP_WIDTH = 46;
const SHIP_HEIGHT = 54;
const SHIP_BOTTOM_OFFSET = 110;

const GAME_LOOP_INTERVAL = 16;
const INITIAL_SPAWN_INTERVAL = 1100;
const MIN_SPAWN_INTERVAL = 380;
const INITIAL_FALL_SPEED = 3;
const MAX_FALL_SPEED = 9.5;
const LEVEL_DURATION = 15000;
const SHIELD_DURATION = 4000;
const SHIELD_SPAWN_CHANCE = 0.12;

const MOVE_INTERVAL_MS = 30;
const MOVE_STEP_PX = 11;

const HIGH_SCORE_KEY = '@asteroid_dodger_high_score_v3';

// ================= STAR DATA (generated once, shared across rounds) =================
const STAR_COUNT = 45;
const STARS = Array.from({ length: STAR_COUNT }).map((_, i) => ({
  id: i,
  x: Math.random() * SCREEN_WIDTH,
  y: Math.random() * SCREEN_HEIGHT,
  size: Math.random() * 2.2 + 0.8,
  opacity: Math.random() * 0.5 + 0.35,
}));

const TWINKLE_COUNT = 14;
const TWINKLE_STARS = Array.from({ length: TWINKLE_COUNT }).map((_, i) => ({
  id: i,
  x: Math.random() * SCREEN_WIDTH,
  y: Math.random() * SCREEN_HEIGHT,
  size: Math.random() * 2 + 1.5,
}));

// ================= TYPES =================
interface Asteroid {
  id: number;
  x: number;
  y: number;
  size: number;
  speed: number;
  rotation: number;
  spin: number;
}

interface Powerup {
  id: number;
  x: number;
  y: number;
  speed: number;
}

// ================= SHARED VISUAL SUB COMPONENTS =================

function ScrollingStarfield() {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(Animated.timing(t, { toValue: 1, duration: 9000, useNativeDriver: true })).start();
  }, [t]);

  const translateY1 = t.interpolate({ inputRange: [0, 1], outputRange: [-SCREEN_HEIGHT, 0] });
  const translateY2 = t.interpolate({ inputRange: [0, 1], outputRange: [0, SCREEN_HEIGHT] });

  const renderStars = () =>
    STARS.map((s) => (
      <View
        key={s.id}
        style={{
          position: 'absolute',
          left: s.x,
          top: s.y,
          width: s.size,
          height: s.size,
          borderRadius: s.size,
          backgroundColor: '#FFFFFF',
          opacity: s.opacity,
        }}
      />
    ));

  return (
    <>
      <Animated.View style={[styles.starLayer, { transform: [{ translateY: translateY1 }] }]}>
        {renderStars()}
      </Animated.View>
      <Animated.View style={[styles.starLayer, { transform: [{ translateY: translateY2 }] }]}>
        {renderStars()}
      </Animated.View>
    </>
  );
}

const TwinkleStar = memo(({ x, y, size }: { x: number; y: number; size: number }) => {
  const opacity = useRef(new Animated.Value(Math.random())).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 900 + Math.random() * 1200, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.15, duration: 900 + Math.random() * 1200, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: '#BFEFFF',
        opacity,
      }}
    />
  );
});

const AsteroidItem = memo(({ x, y, size, rotation }: Asteroid) => {
  const scale = useRef(new Animated.Value(0.3)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5 }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: size,
        height: size,
        opacity,
        transform: [{ scale }, { rotate: `${rotation}deg` }],
      }}
    >
      <LinearGradient
        colors={['#9C8072', '#6B5647', '#3E3229']}
        style={[styles.asteroidBody, { width: size, height: size, borderRadius: size / 2 }]}
      >
        <View style={[styles.crater, { width: size * 0.28, height: size * 0.28, top: size * 0.18, left: size * 0.15 }]} />
        <View style={[styles.crater, { width: size * 0.18, height: size * 0.18, top: size * 0.5, left: size * 0.55 }]} />
      </LinearGradient>
    </Animated.View>
  );
});

const PowerupItem = memo(({ x, y, size }: { x: number; y: number; size: number }) => {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.25, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);

  return (
    <Animated.View style={{ position: 'absolute', left: x, top: y, width: size, height: size, transform: [{ scale: pulse }] }}>
      <LinearGradient colors={['#8FF7FF', '#4FD1C5', '#1F8A82']} style={[styles.powerup, { width: size, height: size, borderRadius: size / 2 }]} />
    </Animated.View>
  );
});

function ExplosionEffect({ x, y }: { x: number; y: number }) {
  const particles = useRef(
    Array.from({ length: 14 }).map(() => ({
      anim: new Animated.Value(0),
      angle: Math.random() * Math.PI * 2,
      distance: 40 + Math.random() * 60,
    }))
  ).current;

  useEffect(() => {
    Animated.stagger(
      10,
      particles.map((p) => Animated.timing(p.anim, { toValue: 1, duration: 550 + Math.random() * 200, useNativeDriver: true }))
    ).start();
  }, [particles]);

  return (
    <View style={{ position: 'absolute', left: x, top: y }} pointerEvents="none">
      {particles.map((p, i) => {
        const translateX = p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(p.angle) * p.distance] });
        const translateY = p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(p.angle) * p.distance] });
        const opacity = p.anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
        const scale = p.anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.2] });

        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: i % 2 === 0 ? '#FF6B6B' : '#F6C453',
              opacity,
              transform: [{ translateX }, { translateY }, { scale }],
            }}
          />
        );
      })}
    </View>
  );
}

// ================= GAME AREA =================
// Everything that belongs to a single round of play lives in this component.
// Because the parent gives it a fresh `key` every time a round starts, React
// fully unmounts the old instance and mounts a brand new one — every piece of
// state and every ref below starts from its initial value automatically. This
// is what guarantees restart can never inherit leftover state from the last round.
interface GameAreaProps {
  highScore: number;
  onGameOver: (finalScore: number) => void;
}

function GameArea({ highScore, onGameOver }: GameAreaProps) {
  const [asteroids, setAsteroids] = useState<Asteroid[]>([]);
  const [powerups, setPowerups] = useState<Powerup[]>([]);
  const [score, setScore] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [level, setLevel] = useState(1);
  const [shieldActive, setShieldActive] = useState(false);
  const [explosionPos, setExplosionPos] = useState<{ x: number; y: number } | null>(null);
  const [isOver, setIsOver] = useState(false);

  const asteroidsRef = useRef<Asteroid[]>([]);
  const powerupsRef = useRef<Powerup[]>([]);
  const scoreRef = useRef(0);
  const isOverRef = useRef(false);
  const isPausedRef = useRef(false);
  const shieldUntilRef = useRef(0);
  const nextAsteroidId = useRef(0);
  const nextPowerupId = useRef(0);
  const lastSpawnTime = useRef(0);
  const elapsedTime = useRef(0);
  const levelRef = useRef(1);
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const moveHoldInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const shipAnim = useRef(new Animated.Value(SCREEN_WIDTH / 2 - SHIP_WIDTH / 2)).current;
  const shipTilt = useRef(new Animated.Value(0)).current;
  const shipXRef = useRef(SCREEN_WIDTH / 2 - SHIP_WIDTH / 2);
  const shieldPulse = useRef(new Animated.Value(1)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const levelToastAnim = useRef(new Animated.Value(0)).current;
  const thrusterPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const id = shipAnim.addListener(({ value }) => {
      shipXRef.current = value;
    });
    return () => shipAnim.removeListener(id);
  }, [shipAnim]);

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(thrusterPulse, { toValue: 1.3, duration: 220, useNativeDriver: true }),
        Animated.timing(thrusterPulse, { toValue: 0.9, duration: 220, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [thrusterPulse]);

  const checkOverlap = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number }
  ) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  const triggerShake = () => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 1, duration: 40, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -1, duration: 40, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 1, duration: 40, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 40, useNativeDriver: true }),
    ]).start();
  };

  const showLevelToast = () => {
    levelToastAnim.setValue(0);
    Animated.sequence([
      Animated.timing(levelToastAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(900),
      Animated.timing(levelToastAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  };

  const stopMoving = useCallback(() => {
    if (moveHoldInterval.current) {
      clearInterval(moveHoldInterval.current);
      moveHoldInterval.current = null;
    }
    Animated.timing(shipTilt, { toValue: 0, duration: 180, useNativeDriver: true }).start();
  }, [shipTilt]);

  // ================= GAME LOOP =================
  const tick = useCallback(() => {
    if (isOverRef.current || isPausedRef.current) return;

    elapsedTime.current += GAME_LOOP_INTERVAL;

    const progress = Math.min(elapsedTime.current / 65000, 1);
    const spawnInterval = INITIAL_SPAWN_INTERVAL - progress * (INITIAL_SPAWN_INTERVAL - MIN_SPAWN_INTERVAL);
    const maxSpeed = INITIAL_FALL_SPEED + progress * (MAX_FALL_SPEED - INITIAL_FALL_SPEED);

    const newLevel = Math.floor(elapsedTime.current / LEVEL_DURATION) + 1;
    if (newLevel !== levelRef.current) {
      levelRef.current = newLevel;
      setLevel(newLevel);
      showLevelToast();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    if (shieldUntilRef.current > 0 && elapsedTime.current > shieldUntilRef.current) {
      shieldUntilRef.current = 0;
      setShieldActive(false);
    }

    lastSpawnTime.current += GAME_LOOP_INTERVAL;
    let updatedAsteroids = asteroidsRef.current;
    let spawnedThisTick = false;
    if (lastSpawnTime.current >= spawnInterval) {
      lastSpawnTime.current = 0;
      spawnedThisTick = true;
      const size = Math.random() * 32 + 26;
      const x = Math.random() * (SCREEN_WIDTH - size);
      const speed = Math.random() * (maxSpeed - INITIAL_FALL_SPEED) + INITIAL_FALL_SPEED;
      updatedAsteroids = [
        ...updatedAsteroids,
        {
          id: nextAsteroidId.current++,
          x,
          y: -size,
          size,
          speed,
          rotation: Math.random() * 360,
          spin: (Math.random() - 0.5) * 6,
        },
      ];
    }

    updatedAsteroids = updatedAsteroids
      .map((a) => ({ ...a, y: a.y + a.speed, rotation: a.rotation + a.spin }))
      .filter((a) => a.y < SCREEN_HEIGHT + 60);

    let updatedPowerups = powerupsRef.current;
    if (elapsedTime.current > 8000 && spawnedThisTick && Math.random() < SHIELD_SPAWN_CHANCE) {
      const size = 34;
      updatedPowerups = [
        ...updatedPowerups,
        { id: nextPowerupId.current++, x: Math.random() * (SCREEN_WIDTH - size), y: -size, speed: 3.5 },
      ];
    }
    updatedPowerups = updatedPowerups.map((p) => ({ ...p, y: p.y + p.speed })).filter((p) => p.y < SCREEN_HEIGHT + 60);

    const shipRect = {
      x: shipXRef.current,
      y: SCREEN_HEIGHT - SHIP_BOTTOM_OFFSET - SHIP_HEIGHT,
      w: SHIP_WIDTH,
      h: SHIP_HEIGHT,
    };

    const remainingPowerups: Powerup[] = [];
    let collected = false;
    for (const p of updatedPowerups) {
      if (checkOverlap(shipRect, { x: p.x, y: p.y, w: 34, h: 34 })) {
        collected = true;
      } else {
        remainingPowerups.push(p);
      }
    }
    if (collected) {
      shieldUntilRef.current = elapsedTime.current + SHIELD_DURATION;
      setShieldActive(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    const shielded = shieldUntilRef.current > 0;
    const hit = !shielded && updatedAsteroids.some((a) => checkOverlap(shipRect, { x: a.x, y: a.y, w: a.size, h: a.size }));

    asteroidsRef.current = updatedAsteroids;
    powerupsRef.current = remainingPowerups;
    setAsteroids(updatedAsteroids);
    setPowerups(remainingPowerups);

    if (hit) {
      isOverRef.current = true;
      setIsOver(true);

      if (loopRef.current) {
        clearInterval(loopRef.current);
        loopRef.current = null;
      }
      stopMoving();

      setExplosionPos({ x: shipRect.x + SHIP_WIDTH / 2 - 4, y: shipRect.y + SHIP_HEIGHT / 2 - 4 });
      triggerShake();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      const finalScore = scoreRef.current;
      // Give the explosion a brief moment to be visible before handing control back
      // to the parent, which will swap in the Game Over screen.
      setTimeout(() => onGameOver(finalScore), 500);
      return;
    }

    scoreRef.current += 1;
    setScore(scoreRef.current);
  }, [onGameOver, stopMoving]);

  // Start the loop once, on mount. Because this whole component remounts fresh
  // every round (see the `key` prop where <GameArea> is used), this effect always
  // runs exactly once per round, from a completely clean slate.
  useEffect(() => {
    loopRef.current = setInterval(tick, GAME_LOOP_INTERVAL);
    return () => {
      if (loopRef.current) clearInterval(loopRef.current);
      if (moveHoldInterval.current) clearInterval(moveHoldInterval.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (shieldActive) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(shieldPulse, { toValue: 1.35, duration: 350, useNativeDriver: true }),
          Animated.timing(shieldPulse, { toValue: 1, duration: 350, useNativeDriver: true }),
        ])
      );
      anim.start();
      return () => anim.stop();
    }
  }, [shieldActive, shieldPulse]);

  const stepShip = (direction: -1 | 1) => {
    const next = Math.max(0, Math.min(SCREEN_WIDTH - SHIP_WIDTH, shipXRef.current + direction * MOVE_STEP_PX));
    shipAnim.setValue(next);
    shipTilt.setValue(direction * 14);
  };

  const startMoving = (direction: -1 | 1) => {
    if (isOverRef.current || isPausedRef.current) return;
    Haptics.selectionAsync();
    if (moveHoldInterval.current) clearInterval(moveHoldInterval.current);
    stepShip(direction);
    moveHoldInterval.current = setInterval(() => stepShip(direction), MOVE_INTERVAL_MS);
  };

  const togglePause = () => {
    const next = !isPausedRef.current;
    isPausedRef.current = next;
    setIsPaused(next);
    if (next) stopMoving();
    Haptics.selectionAsync();
  };

  const shakeTranslate = shakeAnim.interpolate({ inputRange: [-1, 1], outputRange: [-8, 8] });

  return (
    <Animated.View style={{ flex: 1, transform: [{ translateX: shakeTranslate }] }}>
      <View style={styles.hud}>
        <Text style={styles.title}>Space Escape Runner</Text>
        <View style={styles.scoreRow}>
          <LinearGradient colors={['#1A1F33', '#12162A']} style={styles.scoreBox}>
            <Text style={styles.scoreLabel}>SCORE</Text>
            <Text style={styles.scoreValue}>{score}</Text>
          </LinearGradient>
          <LinearGradient colors={['#1A1F33', '#12162A']} style={styles.scoreBox}>
            <Text style={styles.scoreLabel}>BEST</Text>
            <Text style={styles.scoreValueSecondary}>{Math.max(highScore, score)}</Text>
          </LinearGradient>
          <LinearGradient colors={['#1A1F33', '#12162A']} style={styles.scoreBox}>
            <Text style={styles.scoreLabel}>LEVEL</Text>
            <Text style={styles.scoreValueLevel}>{level}</Text>
          </LinearGradient>
        </View>
      </View>

      {!isOver && (
        <TouchableOpacity style={styles.pauseButton} onPress={togglePause}>
          <Text style={styles.pauseIcon}>{isPaused ? '▶' : '❚❚'}</Text>
        </TouchableOpacity>
      )}

      <Animated.View
        pointerEvents="none"
        style={[
          styles.levelToast,
          {
            opacity: levelToastAnim,
            transform: [{ translateY: levelToastAnim.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }],
          },
        ]}
      >
        <Text style={styles.levelToastText}>LEVEL {level}</Text>
      </Animated.View>

      {powerups.map((p) => (
        <PowerupItem key={p.id} x={p.x} y={p.y} size={34} />
      ))}

      {asteroids.map((a) => (
        <AsteroidItem key={a.id} {...a} />
      ))}

      {explosionPos && <ExplosionEffect x={explosionPos.x} y={explosionPos.y} />}

      {!isOver && (
        <Animated.View
          style={[
            styles.ship,
            {
              bottom: SHIP_BOTTOM_OFFSET,
              transform: [
                { translateX: shipAnim },
                { rotate: shipTilt.interpolate({ inputRange: [-20, 0, 20], outputRange: ['-20deg', '0deg', '20deg'] }) },
              ],
            },
          ]}
        >
          {shieldActive && <Animated.View style={[styles.shieldRing, { transform: [{ scale: shieldPulse }] }]} />}
          <View style={styles.shipNose} />
          <LinearGradient colors={['#E8F7F5', '#B9E8E3', '#4FD1C5']} style={styles.shipBody} />
          <View style={styles.shipFinLeft} />
          <View style={styles.shipFinRight} />
          <Animated.View style={[styles.shipThruster, { transform: [{ scaleY: thrusterPulse }] }]}>
            <LinearGradient colors={['#FFE29A', '#F6C453', '#FF8A3D']} style={styles.thrusterGradient} />
          </Animated.View>
        </Animated.View>
      )}

      {!isOver && !isPaused && (
        <View style={styles.controls}>
          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.controlButton}
            onPressIn={() => startMoving(-1)}
            onPressOut={stopMoving}
          >
            <LinearGradient colors={['#4FD1C5', '#2C9A90']} style={styles.controlGradient}>
              <Text style={styles.controlText}>◀</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.controlButton}
            onPressIn={() => startMoving(1)}
            onPressOut={stopMoving}
          >
            <LinearGradient colors={['#4FD1C5', '#2C9A90']} style={styles.controlGradient}>
              <Text style={styles.controlText}>▶</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

      {isPaused && !isOver && (
        <View style={styles.overlay}>
          <Text style={styles.overlayTitle}>Paused</Text>
          <TouchableOpacity style={styles.startButtonWrap} onPress={togglePause}>
            <LinearGradient colors={['#4FD1C5', '#2C9A90']} style={styles.startButton}>
              <Text style={styles.startButtonText}>Resume</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}
    </Animated.View>
  );
}

// ================= ROOT SCREEN =================
// Owns only what must survive across rounds: the persisted high score and which
// screen (start / playing / game over) is showing. Actual gameplay lives entirely
// inside <GameArea>, remounted fresh via `sessionId` every time a round begins.
type Screen = 'start' | 'playing' | 'gameover';

export default function HomeScreen() {
  const [screen, setScreen] = useState<Screen>('start');
  const [highScore, setHighScore] = useState(0);
  const [lastScore, setLastScore] = useState(0);
  const [sessionId, setSessionId] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(HIGH_SCORE_KEY);
        if (saved !== null) setHighScore(parseInt(saved, 10));
      } catch (e) {
        console.log('Failed to load high score', e);
      }
    })();
  }, []);

  const saveHighScore = async (value: number) => {
    try {
      await AsyncStorage.setItem(HIGH_SCORE_KEY, value.toString());
    } catch (e) {
      console.log('Failed to save high score', e);
    }
  };

  const handleGameOver = useCallback(
    (finalScore: number) => {
      setLastScore(finalScore);
      if (finalScore > highScore) {
        setHighScore(finalScore);
        saveHighScore(finalScore);
      }
      setScreen('gameover');
    },
    [highScore]
  );

  const startGame = () => {
    setSessionId((id) => id + 1);
    setScreen('playing');
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient colors={['#0A0E2A', '#05060F', '#000000']} style={StyleSheet.absoluteFill} />
      <ScrollingStarfield />
      {TWINKLE_STARS.map((s) => (
        <TwinkleStar key={s.id} x={s.x} y={s.y} size={s.size} />
      ))}

      {screen === 'playing' && <GameArea key={sessionId} highScore={highScore} onGameOver={handleGameOver} />}

      {screen === 'start' && (
        <View style={styles.overlay}>
          <Text style={styles.overlayTitle}>Space Escape Runner</Text>
          <Text style={styles.overlaySubtitle}>
            Hold ◀ or ▶ to steer. Dodge the asteroids. Grab the glowing shield for temporary invincibility.
          </Text>
          <TouchableOpacity style={styles.startButtonWrap} onPress={startGame}>
            <LinearGradient colors={['#4FD1C5', '#2C9A90']} style={styles.startButton}>
              <Text style={styles.startButtonText}>Start Game</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

      {screen === 'gameover' && (
        <View style={styles.overlay}>
          <Text style={styles.gameOverTitle}>Game Over</Text>
          <Text style={styles.finalScore}>Score: {lastScore}</Text>
          <Text style={styles.finalHighScore}>Best: {highScore}</Text>
          <TouchableOpacity style={styles.startButtonWrap} onPress={startGame}>
            <LinearGradient colors={['#4FD1C5', '#2C9A90']} style={styles.startButton}>
              <Text style={styles.startButtonText}>Restart</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ================= STYLES =================
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#05060F', overflow: 'hidden' },
  starLayer: { position: 'absolute', top: 0, left: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT },

  hud: { position: 'absolute', top: 50, left: 0, right: 0, alignItems: 'center', zIndex: 10 },
  title: { fontSize: 19, fontWeight: 'bold', color: '#FFFFFF', letterSpacing: 1, marginBottom: 12 },
  scoreRow: { flexDirection: 'row' },
  scoreBox: {
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2E3A59',
    marginHorizontal: 5,
  },
  scoreLabel: { fontSize: 10, color: '#8A93B2', letterSpacing: 1 },
  scoreValue: { fontSize: 20, fontWeight: 'bold', color: '#4FD1C5' },
  scoreValueSecondary: { fontSize: 20, fontWeight: 'bold', color: '#F6C453' },
  scoreValueLevel: { fontSize: 20, fontWeight: 'bold', color: '#B18CFF' },

  pauseButton: {
    position: 'absolute',
    top: 52,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 11,
  },
  pauseIcon: { color: '#FFFFFF', fontSize: 14 },

  levelToast: { position: 'absolute', top: 140, left: 0, right: 0, alignItems: 'center', zIndex: 12 },
  levelToastText: {
    color: '#B18CFF',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 2,
    backgroundColor: 'rgba(26,31,51,0.9)',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#B18CFF',
    overflow: 'hidden',
  },

  asteroidBody: { alignItems: 'center', justifyContent: 'center' },
  crater: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 50 },

  powerup: {
    shadowColor: '#4FD1C5',
    shadowOpacity: 0.9,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },

  ship: { position: 'absolute', width: SHIP_WIDTH, height: SHIP_HEIGHT, alignItems: 'center', zIndex: 5, left: 0 },
  shieldRing: {
    position: 'absolute',
    top: -8,
    width: SHIP_WIDTH + 20,
    height: SHIP_HEIGHT + 20,
    borderRadius: (SHIP_WIDTH + 20) / 2,
    borderWidth: 2,
    borderColor: '#8FF7FF',
  },
  shipNose: {
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderBottomWidth: 18,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#4FD1C5',
  },
  shipBody: { width: 22, height: 20, borderRadius: 6, marginTop: -2 },
  shipFinLeft: {
    position: 'absolute',
    bottom: 4,
    left: 0,
    width: 0,
    height: 0,
    borderTopWidth: 13,
    borderRightWidth: 9,
    borderTopColor: 'transparent',
    borderRightColor: '#2C9A90',
  },
  shipFinRight: {
    position: 'absolute',
    bottom: 4,
    right: 0,
    width: 0,
    height: 0,
    borderTopWidth: 13,
    borderLeftWidth: 9,
    borderTopColor: 'transparent',
    borderLeftColor: '#2C9A90',
  },
  shipThruster: { width: 9, height: 9, marginTop: -1 },
  thrusterGradient: { flex: 1, borderRadius: 4.5 },

  controls: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 30,
    zIndex: 6,
  },
  controlButton: { width: 68, height: 68, borderRadius: 34, overflow: 'hidden' },
  controlGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  controlText: { fontSize: 28, color: '#0B0E1A', fontWeight: 'bold' },

  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5,6,15,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    paddingHorizontal: 30,
  },
  overlayTitle: { fontSize: 28, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 12, textAlign: 'center' },
  overlaySubtitle: { fontSize: 14, color: '#8A93B2', marginBottom: 40, textAlign: 'center', lineHeight: 20 },
  gameOverTitle: { fontSize: 32, fontWeight: 'bold', color: '#FF6B6B', marginBottom: 18 },
  finalScore: { fontSize: 20, color: '#FFFFFF', marginBottom: 6 },
  finalHighScore: { fontSize: 16, color: '#F6C453', marginBottom: 40 },

  startButtonWrap: {
    borderRadius: 30,
    shadowColor: '#4FD1C5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  startButton: { paddingVertical: 16, paddingHorizontal: 55, borderRadius: 30 },
  startButtonText: { color: '#0B0E1A', fontSize: 18, fontWeight: '700', letterSpacing: 1 },
});
