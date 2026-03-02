// Resource deck for Plunder: A Pirate's Life
import { RESOURCE_TYPES } from '../../shared/constants.js';

export function createResourceDeck() {
  const deck = [];
  // 150 total: ~38 each for wood, iron, rum; ~36 gold
  const counts = { wood: 38, iron: 38, rum: 38, gold: 36 };

  for (const [resource, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      deck.push(resource);
    }
  }

  return shuffle(deck);
}

export function createTreasureDeck() {
  const deck = [];

  // Gold rewards
  for (let i = 0; i < 8; i++) deck.push({ type: 'gold', amount: 1, description: 'Found 1 gold!' });
  for (let i = 0; i < 6; i++) deck.push({ type: 'gold', amount: 2, description: 'Found 2 gold!' });
  for (let i = 0; i < 4; i++) deck.push({ type: 'gold', amount: 3, description: 'A chest of 3 gold!' });
  for (let i = 0; i < 3; i++) deck.push({ type: 'gold', amount: 4, description: 'A treasure trove! 4 gold!' });
  for (let i = 0; i < 2; i++) deck.push({ type: 'gold', amount: 5, description: 'Massive haul! 5 gold!' });

  // Steal resources
  for (let i = 0; i < 4; i++) deck.push({ type: 'steal', amount: 2, description: 'Steal 2 random resources from a player!' });
  for (let i = 0; i < 4; i++) deck.push({ type: 'steal', amount: 1, description: 'Steal 1 random resource from a player!' });

  // Plunder points
  for (let i = 0; i < 6; i++) deck.push({ type: 'plunder_point', amount: 1, description: 'Plunder Point!' });

  // Bonus resources
  for (let i = 0; i < 3; i++) deck.push({ type: 'resource', resource: 'wood', amount: 3, description: 'Found 3 wood!' });
  for (let i = 0; i < 3; i++) deck.push({ type: 'resource', resource: 'iron', amount: 3, description: 'Found 3 iron!' });
  for (let i = 0; i < 2; i++) deck.push({ type: 'resource', resource: 'rum', amount: 3, description: 'Found 3 rum!' });
  for (let i = 0; i < 2; i++) deck.push({ type: 'resource', resource: 'rum', amount: 2, description: 'Found 2 rum!' });

  // Storm/hazard
  for (let i = 0; i < 3; i++) deck.push({ type: 'storm', description: 'Storm strikes! Lose 2 resources of your choice.' });
  for (let i = 0; i < 3; i++) deck.push({ type: 'end_turn', description: 'Rough seas! Your turn ends immediately.' });

  return shuffle(deck);
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function drawFromDeck(deck, count = 1) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (deck.length === 0) break;
    drawn.push(deck.pop());
  }
  return drawn;
}
