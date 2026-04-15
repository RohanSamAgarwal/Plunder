import { EVENTS } from '../../shared/constants.js';
import { forceEndTurn } from './gameState.js';

// === TURN TIMER & VOTE-TO-SKIP MODULE ===

export function startTurnTimers(room, io, broadcastFn) {
  stopTurnTimers(room);

  const state = room.gameState;
  if (!state || state.phase !== 'gameplay') return;

  state.turnStartedAt = Date.now();
  room._broadcastFn = broadcastFn;
  room._io = io;
  room.turnTimers = {};

  const { softTimerSeconds, hardTimerSeconds } = state.settings;

  if (softTimerSeconds > 0) {
    room.turnTimers.softTimeout = setTimeout(
      () => onSoftTimerFired(room),
      softTimerSeconds * 1000,
    );
  }

  if (hardTimerSeconds > 0) {
    room.turnTimers.hardTimeout = setTimeout(
      () => onHardTimerFired(room),
      hardTimerSeconds * 1000,
    );
  }
}

export function stopTurnTimers(room) {
  if (room.turnTimers) {
    clearTimeout(room.turnTimers.softTimeout);
    clearTimeout(room.turnTimers.hardTimeout);
  }
  room.turnTimers = null;
  room.skipVote = null;
}

function onSoftTimerFired(room) {
  const io = room._io;
  const state = room.gameState;
  if (!state || state.phase !== 'gameplay') return;

  const currentPlayerId = state.turnOrder[state.currentPlayerIndex];

  // Count connected non-current players as eligible voters
  const eligible = room.players.filter(
    p => p.id !== currentPlayerId && p.connected,
  );
  if (eligible.length === 0) return; // no one to vote; hard timer will handle it

  room.skipVote = {
    currentPlayerId,
    voters: {},
    eligibleCount: eligible.length,
  };

  io.to(room.code).emit(EVENTS.TURN_TIMER_VOTE_START, {
    currentPlayerId,
    currentPlayerName: state.players[currentPlayerId]?.name || 'Unknown',
  });
}

function onHardTimerFired(room) {
  const io = room._io;
  const broadcastFn = room._broadcastFn;
  const state = room.gameState;
  if (!state || state.phase !== 'gameplay') return;

  const skippedName = state.players[state.turnOrder[state.currentPlayerIndex]]?.name || 'Unknown';
  const result = forceEndTurn(state);

  stopTurnTimers(room);
  broadcastFn(room);

  const nextName = state.players[result.nextPlayer]?.name || 'Unknown';
  io.to(room.code).emit(EVENTS.TURN_TIMER_EXPIRED, { skippedPlayerName: skippedName });
  io.to(room.code).emit(EVENTS.TURN_ENDED, { ...result, nextPlayerName: nextName });

  startTurnTimers(room, io, broadcastFn);
}

export function handleSkipVote(room, playerId, vote, io) {
  const skipVote = room.skipVote;
  if (!skipVote) return { error: 'No active vote' };
  if (playerId === skipVote.currentPlayerId) return { error: 'Current player cannot vote' };
  if (skipVote.voters[playerId] !== undefined) return { error: 'Already voted' };

  skipVote.voters[playerId] = vote;
  resolveVoteIfReady(room);
  return { success: true };
}

export function onPlayerDisconnectDuringVote(room, playerId) {
  const skipVote = room.skipVote;
  if (!skipVote) return;

  // Remove their vote and reduce eligible count
  if (skipVote.voters[playerId] !== undefined) {
    delete skipVote.voters[playerId];
  }
  // Recalculate eligible from current connected non-current players
  const state = room.gameState;
  const currentPlayerId = state.turnOrder[state.currentPlayerIndex];
  skipVote.eligibleCount = room.players.filter(
    p => p.id !== currentPlayerId && p.connected,
  ).length;

  if (skipVote.eligibleCount === 0) {
    room.skipVote = null;
    return;
  }

  resolveVoteIfReady(room);
}

function resolveVoteIfReady(room) {
  const io = room._io;
  const broadcastFn = room._broadcastFn;
  const skipVote = room.skipVote;
  if (!skipVote || !io) return;

  const votes = Object.values(skipVote.voters);
  const yesCount = votes.filter(v => v === true).length;
  const noCount = votes.filter(v => v === false).length;
  const majority = Math.floor(skipVote.eligibleCount / 2) + 1;

  const passed = yesCount >= majority;
  const failed = noCount > skipVote.eligibleCount - majority; // mathematically impossible to pass
  const allVoted = votes.length >= skipVote.eligibleCount;

  if (!passed && !failed && !allVoted) return; // still waiting

  const state = room.gameState;

  if (passed) {
    const skippedName = state.players[skipVote.currentPlayerId]?.name || 'Unknown';
    const result = forceEndTurn(state);
    stopTurnTimers(room);
    broadcastFn(room);

    const nextName = state.players[result.nextPlayer]?.name || 'Unknown';
    io.to(room.code).emit(EVENTS.TURN_TIMER_VOTE_RESULT, {
      passed: true,
      skippedPlayerName: skippedName,
    });
    io.to(room.code).emit(EVENTS.TURN_ENDED, { ...result, nextPlayerName: nextName });
    startTurnTimers(room, io, broadcastFn);
  } else {
    // Vote failed — clear vote state, hard timer continues
    room.skipVote = null;
    io.to(room.code).emit(EVENTS.TURN_TIMER_VOTE_RESULT, { passed: false });
  }
}
