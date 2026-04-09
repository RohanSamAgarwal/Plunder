import { useState } from 'react';

const BUILD_COSTS = {
  ship: { wood: 2, iron: 1, rum: 0, gold: 2 },
  cannon: { wood: 0, iron: 2, rum: 1, gold: 1 },
  mast: { wood: 1, iron: 0, rum: 2, gold: 0 },
  lifePeg: { wood: 1, iron: 1, rum: 1, gold: 1 },
  plunderPoint: { wood: 0, iron: 0, rum: 0, gold: 5 },
};

const RESOURCE_META = {
  wood: { label: 'Wood', color: '#8B5E3C', bg: 'rgba(139,94,60,0.15)', border: 'rgba(139,94,60,0.3)' },
  iron: { label: 'Iron', color: '#9CA3AF', bg: 'rgba(156,163,175,0.15)', border: 'rgba(156,163,175,0.3)' },
  rum: { label: 'Rum', color: '#C2410C', bg: 'rgba(194,65,12,0.15)', border: 'rgba(194,65,12,0.3)' },
  gold: { label: 'Gold', color: '#EAB308', bg: 'rgba(234,179,8,0.15)', border: 'rgba(234,179,8,0.3)' },
};

const EMPTY_RESOURCES = { wood: 0, iron: 0, rum: 0, gold: 0 };

export default function ActionPanel({
  gameState, myPlayer, isMyTurn, turnPhase, phase,
  selectedShip, onDrawResources, onRollDie, onBuild, onEndTurn, emit,
  pendingTreaty,
}) {
  const [showTrade, setShowTrade] = useState(false);
  const [tradeTarget, setTradeTarget] = useState('');
  const [tradeOffer, setTradeOffer] = useState({ ...EMPTY_RESOURCES });
  const [tradeRequest, setTradeRequest] = useState({ ...EMPTY_RESOURCES });
  const [showBuild, setShowBuild] = useState(false);
  const [showMerchant, setShowMerchant] = useState(false);
  const [merchantReceive, setMerchantReceive] = useState('wood');
  const [merchantGive, setMerchantGive] = useState({ ...EMPTY_RESOURCES });
  const [showTreaty, setShowTreaty] = useState(false);
  const [treatyTarget, setTreatyTarget] = useState('');
  const [treatyOffer, setTreatyOffer] = useState({ ...EMPTY_RESOURCES });
  const [treasureTargetId, setTreasureTargetId] = useState('');
  const [treasureDiscards, setTreasureDiscards] = useState({ ...EMPTY_RESOURCES });
  const [shiplessFreeResource, setShiplessFreeResource] = useState('');
  const [shiplessRollResult, setShiplessRollResult] = useState(null);
  const [stormCostDiscards, setStormCostDiscards] = useState({ ...EMPTY_RESOURCES });
  const [rerollCost, setRerollCost] = useState({ ...EMPTY_RESOURCES });
  const [showRerollPicker, setShowRerollPicker] = useState(null); // 'sailing' | 'shipless_0' | 'shipless_1' | null

  if (!myPlayer) return null;

  const resources = myPlayer.resources;

  function canAfford(cost) {
    return Object.entries(cost).every(([r, amt]) => (resources[r] || 0) >= amt);
  }

  async function submitTrade() {
    if (!tradeTarget) return;
    await emit('propose-trade', { toPlayerId: tradeTarget, offer: tradeOffer, request: tradeRequest });
    setShowTrade(false);
    setTradeOffer({ ...EMPTY_RESOURCES });
    setTradeRequest({ ...EMPTY_RESOURCES });
    setTradeTarget('');
  }

  const merchantGiveTotal = Object.values(merchantGive).reduce((s, v) => s + v, 0);

  async function submitMerchantTrade() {
    if (merchantGiveTotal !== 2) return;
    await emit('merchant-trade', { give: merchantGive, receive: merchantReceive });
    setShowMerchant(false);
    setMerchantGive({ ...EMPTY_RESOURCES });
    setMerchantReceive('wood');
  }

  async function submitTreaty() {
    if (!treatyTarget) return;
    await emit('propose-treaty', { targetId: treatyTarget, offer: treatyOffer });
    setShowTreaty(false);
    setTreatyOffer({ ...EMPTY_RESOURCES });
    setTreatyTarget('');
  }

  async function respondTreaty(accepted) {
    await emit('respond-treaty', { accepted, proposerId: pendingTreaty.proposerId, offer: pendingTreaty.offer });
  }

  const pendingTreasure = gameState?.pendingTreasure;
  const isTreasureMine = pendingTreasure && pendingTreasure.playerId === myPlayer.id;

  const pendingStormCost = gameState?.pendingStormCost;
  const isStormCostMine = pendingStormCost && pendingStormCost.playerId === myPlayer.id;

  async function resolveTreasureSteal() {
    if (!treasureTargetId) return;
    await emit('resolve-treasure', { targetId: treasureTargetId });
    setTreasureTargetId('');
  }

  async function resolveTreasureDiscard() {
    const total = Object.values(treasureDiscards).reduce((s, v) => s + v, 0);
    if (total !== pendingTreasure.amount) return;
    await emit('resolve-treasure', { discards: treasureDiscards });
    setTreasureDiscards({ ...EMPTY_RESOURCES });
  }

  async function resolveStormCostDiscard() {
    const total = Object.values(stormCostDiscards).reduce((s, v) => s + v, 0);
    if (total !== pendingStormCost.amount) return;
    await emit('resolve-storm-cost', { discards: stormCostDiscards });
    setStormCostDiscards({ ...EMPTY_RESOURCES });
  }

  async function handleShiplessRoll() {
    const result = await emit('shipless-roll', {});
    if (result?.die1 !== undefined) {
      setShiplessRollResult(result);
      // Don't auto-dismiss if reroll is available
      if (rerollMode === 'none') {
        setTimeout(() => setShiplessRollResult(null), 5000);
      }
    }
  }

  const rerollMode = gameState?.settings?.rerollMode || 'none';
  const hasRerolledSailing = gameState?.hasRerolledSailing || false;
  const hasRerolledShipless = gameState?.hasRerolledShipless || false;
  const totalResources = Object.values(resources).reduce((s, v) => s + v, 0);
  const rerollCostTotal = Object.values(rerollCost).reduce((s, v) => s + v, 0);

  function canPlayerReroll() {
    if (rerollMode === 'none') return false;
    if (rerollMode === 'one_per_game') return (myPlayer.rerollsUsed || 0) < 1;
    if (rerollMode === 'spend_resources') return totalResources >= 3;
    return false;
  }

  function getRerollLabel() {
    if (rerollMode === 'one_per_game') return `Reroll (${1 - (myPlayer.rerollsUsed || 0)} left)`;
    if (rerollMode === 'spend_resources') return 'Reroll (3 Resources)';
    return 'Reroll';
  }

  async function handleSailingReroll() {
    if (rerollMode === 'spend_resources') {
      if (rerollCostTotal !== 3) return;
      await emit('reroll-sailing-die', { resourceCost: rerollCost });
    } else {
      await emit('reroll-sailing-die', {});
    }
    setShowRerollPicker(null);
    setRerollCost({ ...EMPTY_RESOURCES });
  }

  async function handleShiplessReroll(dieIndex) {
    if (rerollMode === 'spend_resources') {
      if (rerollCostTotal !== 3) return;
      await emit('reroll-shipless', { dieIndex, resourceCost: rerollCost });
    } else {
      await emit('reroll-shipless', { dieIndex });
    }
    setShowRerollPicker(null);
    setRerollCost({ ...EMPTY_RESOURCES });
    // Refresh the result display
    const newDice = [...(gameState?.lastShiplessRoll?.dice || [])];
    setShiplessRollResult(prev => prev ? { ...prev, die1: newDice[0] || prev.die1, die2: newDice[1] || prev.die2 } : null);
  }

  const tradeablePlayers = Object.values(gameState.players).filter(
    p => p.id !== myPlayer.id && gameState.tradeEligible?.[p.id]
  );
  const otherPlayers = Object.values(gameState.players).filter(p => p.id !== myPlayer.id);

  const showBuildSection = isMyTurn && phase === 'gameplay' &&
    (turnPhase === 'draw_resources' || turnPhase === 'roll_for_move' || turnPhase === 'perform_actions');
  const isShipless = (myPlayer.ships?.length || 0) === 0;
  const recoveryBlocked = myPlayer.shiplessRecoveryBlocked;
  const showShiplessRoll = isShipless && !recoveryBlocked && gameState.settings?.shiplessMode === 'rulebook' && isMyTurn && phase === 'gameplay';
  const showShiplessAlternatives = isShipless && !recoveryBlocked && gameState.settings?.shiplessMode === 'rulebook' && isMyTurn && phase === 'gameplay' && turnPhase === 'perform_actions';
  const canExchangePP = (myPlayer.plunderPointCards || 0) >= 1;
  const canExchangeGold = (resources?.gold || 0) >= 5;
  const hasIslandsToDisown = (myPlayer.ownedIslands?.length || 0) > 0;
  // Rulebook: free resource if no islands AND no PP
  const showFreeResourceChoice = isShipless && (myPlayer.ownedIslands?.length || 0) === 0 && (myPlayer.plunderPointCards || 0) === 0 && isMyTurn && phase === 'gameplay';

  // Detect if selected ship is at an attackable island port
  const attackableIsland = (() => {
    if (!selectedShip || !isMyTurn || turnPhase !== 'perform_actions') return null;
    const pos = selectedShip.position;
    const tile = gameState.board?.[pos.row]?.[pos.col];
    if (tile?.type !== 'port' || !tile.portOf) return null;
    const island = gameState.islands?.[tile.portOf];
    if (!island || island.type !== 'resource' || island.owner === myPlayer.id) return null;
    return island;
  })();

  async function handleAttackIsland() {
    if (!attackableIsland || !selectedShip) return;
    await emit('attack-island', { shipId: selectedShip.id, islandId: attackableIsland.id });
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {/* ══════ Pending Treaty Modal ══════ */}
      {pendingTreaty && (
        <div className="bg-pirate-dark border border-pirate-gold rounded-lg p-3 space-y-2">
          <h3 className="text-sm text-pirate-gold font-bold">Treaty Proposal</h3>
          <p className="text-xs text-pirate-tan">
            <strong className="text-white">{pendingTreaty.proposerName}</strong> offers a treaty:
          </p>
          <div className="grid grid-cols-4 gap-1">
            {Object.entries(pendingTreaty.offer)
              .filter(([, v]) => v > 0)
              .map(([r, v]) => (
                <div key={r} className="text-center">
                  <div className="text-xs font-bold" style={{ color: RESOURCE_META[r]?.color }}>{RESOURCE_META[r]?.label}</div>
                  <div className="text-sm font-bold text-green-400">+{v}</div>
                </div>
              ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => respondTreaty(true)}
              className="flex-1 bg-green-700 hover:bg-green-600 text-white py-1.5 rounded text-xs transition">
              Accept
            </button>
            <button onClick={() => respondTreaty(false)}
              className="flex-1 bg-red-700 hover:bg-red-600 text-white py-1.5 rounded text-xs transition">
              Decline
            </button>
          </div>
        </div>
      )}

      {/* ══════ Pending Treasure Resolution ══════ */}
      {isTreasureMine && pendingTreasure.type === 'steal' && (
        <div className="bg-pirate-dark border border-pirate-gold rounded-lg p-3 space-y-2">
          <h3 className="text-sm text-pirate-gold font-bold">Treasure: Steal</h3>
          <p className="text-xs text-pirate-tan">Choose a player to steal from:</p>
          <select value={treasureTargetId} onChange={(e) => setTreasureTargetId(e.target.value)}
            className="w-full bg-pirate-dark border border-pirate-tan/30 rounded px-2 py-1 text-xs text-white">
            <option value="">Select player...</option>
            {otherPlayers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={resolveTreasureSteal} disabled={!treasureTargetId}
            className="w-full bg-pirate-gold text-pirate-dark py-1.5 rounded text-xs font-bold
                       hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed transition">
            Steal
          </button>
        </div>
      )}

      {isTreasureMine && pendingTreasure.type === 'storm_discard' && (
        <div className="bg-pirate-dark border border-pirate-gold rounded-lg p-3 space-y-2">
          <h3 className="text-sm text-pirate-gold font-bold">Storm: Discard Resources</h3>
          <p className="text-xs text-pirate-tan">
            Discard {pendingTreasure.amount} resource{pendingTreasure.amount !== 1 ? 's' : ''}:
          </p>
          <div className="grid grid-cols-4 gap-1">
            {Object.keys(EMPTY_RESOURCES).map(r => (
              <div key={r} className="text-center">
                <div className="text-[10px] font-bold" style={{ color: RESOURCE_META[r]?.color }}>{RESOURCE_META[r]?.label}</div>
                <input type="number" min="0" max={resources[r] || 0} value={treasureDiscards[r]}
                  onChange={(e) => setTreasureDiscards(prev => ({ ...prev, [r]: parseInt(e.target.value) || 0 }))}
                  className="w-full bg-pirate-dark border border-pirate-tan/20 rounded text-center text-xs py-0.5 text-white" />
              </div>
            ))}
          </div>
          <div className="text-[10px] text-pirate-tan/60 text-right">
            Selected: {Object.values(treasureDiscards).reduce((s, v) => s + v, 0)} / {pendingTreasure.amount}
          </div>
          <button onClick={resolveTreasureDiscard}
            disabled={Object.values(treasureDiscards).reduce((s, v) => s + v, 0) !== pendingTreasure.amount}
            className="w-full bg-pirate-gold text-pirate-dark py-1.5 rounded text-xs font-bold
                       hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed transition">
            Discard
          </button>
        </div>
      )}

      {/* ══════ Pending Storm Cost ══════ */}
      {isStormCostMine && (
        <div className="bg-pirate-dark border border-cyan-500 rounded-lg p-3 space-y-2">
          <h3 className="text-sm text-cyan-400 font-bold">⛈ Storm Toll</h3>
          <p className="text-xs text-pirate-tan">
            Pay {pendingStormCost.amount} resource{pendingStormCost.amount !== 1 ? 's' : ''} to pass through the storm:
          </p>
          <div className="grid grid-cols-4 gap-1">
            {Object.keys(EMPTY_RESOURCES).map(r => (
              <div key={r} className="text-center">
                <div className="text-[10px] font-bold" style={{ color: RESOURCE_META[r]?.color }}>{RESOURCE_META[r]?.label}</div>
                <input type="number" min="0" max={resources[r] || 0} value={stormCostDiscards[r]}
                  onChange={(e) => setStormCostDiscards(prev => ({ ...prev, [r]: parseInt(e.target.value) || 0 }))}
                  className="w-full bg-pirate-dark border border-pirate-tan/20 rounded text-center text-xs py-0.5 text-white" />
              </div>
            ))}
          </div>
          <div className="text-[10px] text-pirate-tan/60 text-right">
            Selected: {Object.values(stormCostDiscards).reduce((s, v) => s + v, 0)} / {pendingStormCost.amount}
          </div>
          <div className="flex gap-2">
            <button onClick={resolveStormCostDiscard}
              disabled={Object.values(stormCostDiscards).reduce((s, v) => s + v, 0) !== pendingStormCost.amount}
              className="flex-1 bg-cyan-700 text-white py-1.5 rounded text-xs font-bold
                         hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed transition">
              Pay Storm Toll
            </button>
            <button onClick={() => emit('cancel-storm-move', {})}
              className="flex-1 bg-gray-600 text-white py-1.5 rounded text-xs font-bold
                         hover:bg-gray-500 transition">
              Cancel Move
            </button>
          </div>
        </div>
      )}

      {/* ══════ Resources ══════ */}
      <div className="rounded-lg overflow-hidden">
        <div className="px-3 py-1.5 bg-pirate-dark/60 border-b border-pirate-tan/10">
          <h3 className="text-[11px] text-pirate-tan/60 uppercase tracking-wider font-semibold">Resources</h3>
        </div>
        <div className="grid grid-cols-4 gap-1.5 p-2">
          {Object.entries(resources).map(([type, count]) => {
            const meta = RESOURCE_META[type];
            return (
              <div key={type} className="text-center rounded-lg p-2 border"
                   style={{ background: meta.bg, borderColor: meta.border }}>
                <div className="text-lg font-bold text-white">{count}</div>
                <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: meta.color }}>{meta.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ══════ Fleet ══════ */}
      <div className="rounded-lg overflow-hidden">
        <div className="px-3 py-1.5 bg-pirate-dark/60 border-b border-pirate-tan/10">
          <h3 className="text-[11px] text-pirate-tan/60 uppercase tracking-wider font-semibold">
            Fleet ({myPlayer.ships?.length || 0}/3)
          </h3>
        </div>
        <div className="p-2 space-y-1.5">
          {isShipless && (
            <p className="text-xs text-red-400 px-1">No ships! You're shipless.</p>
          )}
          {isShipless && recoveryBlocked && isMyTurn && (
            <p className="text-[10px] text-amber-400 px-1">Must wait until next turn to roll or trade for a ship. You may still build one with resources.</p>
          )}
          {myPlayer.ships?.map((ship, i) => (
            <div key={ship.id} className="flex items-center justify-between bg-pirate-dark/40 rounded px-3 py-2">
              <span className="text-xs text-white font-medium">Ship {i + 1}</span>
              <div className="flex items-center gap-3">
                {/* Life pegs */}
                <div className="flex items-center gap-0.5" title={`Lives: ${ship.lifePegs}/3`}>
                  {[0, 1, 2].map(n => (
                    <span key={n} className="inline-block w-2.5 h-2.5 rounded-full border"
                      style={{
                        backgroundColor: n < ship.lifePegs ? '#ef4444' : 'transparent',
                        borderColor: n < ship.lifePegs ? '#dc2626' : 'rgba(239,68,68,0.25)',
                      }} />
                  ))}
                </div>
                {/* Cannon pegs */}
                <div className="flex items-center gap-0.5" title={`Cannons: ${ship.cannons}/2`}>
                  {[0, 1].map(n => (
                    <span key={n} className="inline-block w-2.5 h-2.5 rounded-full border"
                      style={{
                        backgroundColor: n < ship.cannons ? '#6b7280' : 'transparent',
                        borderColor: n < ship.cannons ? '#4b5563' : 'rgba(107,114,128,0.25)',
                      }} />
                  ))}
                </div>
                {/* Mast pegs */}
                <div className="flex items-center gap-0.5" title={`Masts: ${ship.masts}/2`}>
                  {[0, 1].map(n => (
                    <span key={n} className="inline-block w-2.5 h-2.5 rounded-full border"
                      style={{
                        backgroundColor: n < ship.masts ? '#06b6d4' : 'transparent',
                        borderColor: n < ship.masts ? '#0891b2' : 'rgba(6,182,212,0.25)',
                      }} />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ══════ Plunder Points ══════ */}
      <div className="rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-pirate-dark/60 flex items-center justify-between">
          <span className="text-[11px] text-pirate-tan/60 uppercase tracking-wider font-semibold">Plunder Points</span>
          <span className="text-xl font-bold font-pirate text-pirate-gold">
            {myPlayer.plunderPoints}<span className="text-sm text-pirate-tan/50 font-normal">/{gameState.settings?.ppToWin || 10}</span>
          </span>
        </div>
      </div>

      {/* ══════ Shipless Roll ══════ */}
      {showShiplessRoll && (
        <button onClick={handleShiplessRoll}
          className="w-full bg-purple-700 hover:bg-purple-600 text-white py-2 rounded text-sm transition">
          Roll for Ship (Doubles)
        </button>
      )}

      {/* ══════ Shipless Roll Result ══════ */}
      {shiplessRollResult && (
        <div className="bg-pirate-dark border border-pirate-tan/30 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-center gap-4">
            <div className="flex flex-col items-center gap-1">
              <div className="bg-white text-pirate-dark rounded-lg w-12 h-12 flex items-center justify-center text-xl font-bold shadow-inner">
                {gameState?.lastShiplessRoll?.dice?.[0] ?? shiplessRollResult.die1}
              </div>
              {!shiplessRollResult.doubles && !hasRerolledShipless && rerollMode !== 'none' && canPlayerReroll() && showRerollPicker !== 'shipless_0' && (
                <button onClick={() => {
                  if (rerollMode === 'spend_resources') {
                    setShowRerollPicker('shipless_0');
                    setRerollCost({ ...EMPTY_RESOURCES });
                  } else {
                    handleShiplessReroll(0);
                  }
                }}
                  className="text-[9px] bg-amber-700 hover:bg-amber-600 text-white px-2 py-0.5 rounded transition">
                  Reroll
                </button>
              )}
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="bg-white text-pirate-dark rounded-lg w-12 h-12 flex items-center justify-center text-xl font-bold shadow-inner">
                {gameState?.lastShiplessRoll?.dice?.[1] ?? shiplessRollResult.die2}
              </div>
              {!shiplessRollResult.doubles && !hasRerolledShipless && rerollMode !== 'none' && canPlayerReroll() && showRerollPicker !== 'shipless_1' && (
                <button onClick={() => {
                  if (rerollMode === 'spend_resources') {
                    setShowRerollPicker('shipless_1');
                    setRerollCost({ ...EMPTY_RESOURCES });
                  } else {
                    handleShiplessReroll(1);
                  }
                }}
                  className="text-[9px] bg-amber-700 hover:bg-amber-600 text-white px-2 py-0.5 rounded transition">
                  Reroll
                </button>
              )}
            </div>
          </div>

          {/* Resource picker for shipless reroll (spend mode) */}
          {(showRerollPicker === 'shipless_0' || showRerollPicker === 'shipless_1') && rerollMode === 'spend_resources' && (
            <div className="bg-pirate-dark border border-amber-500/40 rounded-lg p-2 space-y-2">
              <p className="text-[10px] text-amber-400 font-bold">
                Choose 3 resources to reroll die {showRerollPicker === 'shipless_0' ? '1' : '2'}:
              </p>
              <div className="grid grid-cols-4 gap-1">
                {Object.entries(RESOURCE_META).map(([r, meta]) => (
                  <div key={r} className="text-center">
                    <div className="text-[10px] font-bold" style={{ color: meta.color }}>{meta.label}</div>
                    <input type="number" min="0" max={resources[r] || 0} value={rerollCost[r]}
                      onChange={(e) => setRerollCost(prev => ({ ...prev, [r]: Math.min(parseInt(e.target.value) || 0, resources[r] || 0) }))}
                      className="w-full bg-pirate-dark border border-pirate-tan/20 rounded text-center text-xs py-0.5 text-white" />
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-pirate-tan/60 text-right">
                Selected: {rerollCostTotal} / 3
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => handleShiplessReroll(showRerollPicker === 'shipless_0' ? 0 : 1)}
                  disabled={rerollCostTotal !== 3}
                  className="flex-1 bg-amber-700 hover:bg-amber-600 text-white py-1 rounded text-xs transition
                             disabled:opacity-40 disabled:cursor-not-allowed">
                  Confirm Reroll
                </button>
                <button onClick={() => { setShowRerollPicker(null); setRerollCost({ ...EMPTY_RESOURCES }); }}
                  className="flex-1 bg-gray-600 hover:bg-gray-500 text-white py-1 rounded text-xs transition">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {shiplessRollResult.doubles ? (
            <p className="text-green-400 text-sm font-bold text-center">Doubles! You got a ship!</p>
          ) : (
            <p className="text-red-400 text-sm text-center">Not doubles. Try alternatives below or end turn.</p>
          )}
        </div>
      )}

      {/* ══════ Shipless Alternatives ══════ */}
      {showShiplessAlternatives && (
        <div className="space-y-1.5">
          <h4 className="text-[10px] text-pirate-tan/50 uppercase tracking-wider">Alternative Ship Methods</h4>
          {canAfford(BUILD_COSTS.ship) && (
            <button onClick={() => onBuild('ship')}
              className="w-full bg-green-800 hover:bg-green-700 text-white py-1.5 rounded text-xs transition">
              Build Ship (Resources)
            </button>
          )}
          {canExchangePP && (
            <button onClick={() => emit('shipless-exchange-pp', {})}
              className="w-full bg-amber-700 hover:bg-amber-600 text-white py-1.5 rounded text-xs transition">
              Exchange 1 PP Card → Ship
            </button>
          )}
          {canExchangeGold && (
            <button onClick={() => emit('shipless-exchange-gold', {})}
              className="w-full bg-yellow-700 hover:bg-yellow-600 text-white py-1.5 rounded text-xs transition">
              Exchange 5 Gold → Ship
            </button>
          )}
          {hasIslandsToDisown && (
            <div className="space-y-1">
              <p className="text-[10px] text-pirate-tan/50">Disown an island for a ship:</p>
              {myPlayer.ownedIslands?.map(islandId => (
                <button key={islandId} onClick={() => emit('shipless-disown-island', { islandId })}
                  className="w-full bg-red-800 hover:bg-red-700 text-white py-1 rounded text-[10px] transition">
                  Disown Island {islandId}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════ Shipless Free Resource ══════ */}
      {showFreeResourceChoice && (
        <div className="bg-pirate-dark border border-pirate-gold rounded-lg p-3 space-y-2">
          <h4 className="text-xs text-pirate-gold font-bold">Free Resource</h4>
          <p className="text-[10px] text-pirate-tan">No islands or PP — choose 1 free resource:</p>
          <div className="grid grid-cols-4 gap-1">
            {Object.entries(RESOURCE_META).map(([type, meta]) => (
              <button key={type} onClick={() => emit('shipless-choose-resource', { resourceType: type })}
                className="text-center rounded p-1.5 border hover:border-pirate-gold transition"
                style={{ background: meta.bg, borderColor: meta.border }}>
                <div className="text-[10px] font-bold" style={{ color: meta.color }}>{meta.label}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ══════ Turn Actions ══════ */}
      {isMyTurn && phase === 'gameplay' && (
        <div className="space-y-2">
          <h3 className="text-xs text-pirate-gold font-bold uppercase tracking-wider">Your Turn</h3>

          {turnPhase === 'draw_resources' && (
            <button onClick={onDrawResources}
              className="w-full bg-green-700 hover:bg-green-600 text-white py-2 rounded text-sm transition">
              Draw Resources
            </button>
          )}

          {turnPhase === 'roll_for_move' && (
            <button onClick={onRollDie}
              className="w-full bg-blue-700 hover:bg-blue-600 text-white py-2 rounded text-sm transition">
              Roll Sailing Die
            </button>
          )}

          {turnPhase === 'perform_actions' && (
            <>
              <div className="text-xs text-pirate-tan bg-pirate-dark/40 rounded px-2 py-1.5">
                Moves: <span className="text-white font-bold">{gameState.movePointsRemaining}</span>
                {selectedShip && (selectedShip.jettisonBonus || 0) > 0 && (
                  <span className="text-orange-400 font-bold"> +{selectedShip.jettisonBonus}</span>
                )}
                {selectedShip && ' \u2022 Ship selected \u2014 click to move'}
              </div>

              {/* Sailing Die Reroll */}
              {!hasRerolledSailing && rerollMode !== 'none' && canPlayerReroll() && (
                <div className="space-y-1.5">
                  {showRerollPicker === 'sailing' && rerollMode === 'spend_resources' ? (
                    <div className="bg-pirate-dark border border-amber-500/40 rounded-lg p-2 space-y-2">
                      <p className="text-[10px] text-amber-400 font-bold">Choose 3 resources to spend:</p>
                      <div className="grid grid-cols-4 gap-1">
                        {Object.entries(RESOURCE_META).map(([r, meta]) => (
                          <div key={r} className="text-center">
                            <div className="text-[10px] font-bold" style={{ color: meta.color }}>{meta.label}</div>
                            <input type="number" min="0" max={resources[r] || 0} value={rerollCost[r]}
                              onChange={(e) => setRerollCost(prev => ({ ...prev, [r]: Math.min(parseInt(e.target.value) || 0, resources[r] || 0) }))}
                              className="w-full bg-pirate-dark border border-pirate-tan/20 rounded text-center text-xs py-0.5 text-white" />
                          </div>
                        ))}
                      </div>
                      <div className="text-[10px] text-pirate-tan/60 text-right">
                        Selected: {rerollCostTotal} / 3
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={handleSailingReroll} disabled={rerollCostTotal !== 3}
                          className="flex-1 bg-amber-700 hover:bg-amber-600 text-white py-1 rounded text-xs transition
                                     disabled:opacity-40 disabled:cursor-not-allowed">
                          Confirm Reroll
                        </button>
                        <button onClick={() => { setShowRerollPicker(null); setRerollCost({ ...EMPTY_RESOURCES }); }}
                          className="flex-1 bg-gray-600 hover:bg-gray-500 text-white py-1 rounded text-xs transition">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        if (rerollMode === 'spend_resources') {
                          setShowRerollPicker('sailing');
                          setRerollCost({ ...EMPTY_RESOURCES });
                        } else {
                          handleSailingReroll();
                        }
                      }}
                      className="w-full bg-amber-700 hover:bg-amber-600 text-white py-1.5 rounded text-xs transition
                                 border border-amber-500/40">
                      🎲 {getRerollLabel()} Die (rolled {gameState.dieRoll})
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {/* Lightening the Load — Jettison Cannons */}
          {gameState.settings?.lightenTheLoad && selectedShip && selectedShip.cannons > 0 && (selectedShip.jettisonBonus || 0) === 0 && (
            <div className="bg-pirate-dark/50 border border-orange-500/30 rounded-lg p-2 space-y-1.5">
              <h4 className="text-[10px] text-orange-400 uppercase tracking-wider font-semibold">
                ⚓ Lightening the Load
              </h4>
              <p className="text-[10px] text-pirate-tan/60">Throw cannons overboard for bonus movement</p>
              <div className="space-y-1">
                <button
                  onClick={() => emit('jettison-cannons', { shipId: selectedShip.id, count: 1 })}
                  disabled={selectedShip.cannons < 1}
                  className="w-full text-left bg-pirate-dark/50 border border-pirate-tan/10 rounded px-3 py-1.5
                             text-xs hover:border-orange-500/50 transition disabled:opacity-40 disabled:cursor-not-allowed
                             flex items-center justify-between">
                  <span className="text-white font-medium">Jettison 1 Cannon</span>
                  <span className="text-orange-400 font-bold">+1 Move</span>
                </button>
                {selectedShip.cannons >= 2 && (
                  <button
                    onClick={() => emit('jettison-cannons', { shipId: selectedShip.id, count: 2 })}
                    className="w-full text-left bg-pirate-dark/50 border border-pirate-tan/10 rounded px-3 py-1.5
                               text-xs hover:border-orange-500/50 transition
                               flex items-center justify-between">
                    <span className="text-white font-medium">Jettison 2 Cannons</span>
                    <span className="text-orange-400 font-bold">+3 Moves</span>
                  </button>
                )}
              </div>
            </div>
          )}
          {selectedShip && (selectedShip.jettisonBonus || 0) > 0 && (
            <div className="text-[10px] text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded px-2 py-1">
              ⚓ Cannons jettisoned! +{selectedShip.jettisonBonus} bonus move{selectedShip.jettisonBonus !== 1 ? 's' : ''} for this ship
            </div>
          )}

          {/* Attack Island button (when docked at an attackable port) */}
          {attackableIsland && (
            <button onClick={handleAttackIsland}
              className="w-full bg-red-700 hover:bg-red-600 text-white py-2 rounded text-sm font-bold transition
                         border border-red-500/50">
              Attack Island ({attackableIsland.skulls} skull{attackableIsland.skulls !== 1 ? 's' : ''}
              {attackableIsland.owner ? ` \u2014 ${gameState.players[attackableIsland.owner]?.name}` : ' \u2014 Unowned'})
            </button>
          )}

          {/* Build */}
          {showBuildSection && (
            <>
              <button onClick={() => setShowBuild(!showBuild)}
                className="w-full bg-pirate-brown border border-pirate-tan/30 text-pirate-tan
                           py-1.5 rounded text-sm hover:border-pirate-gold transition">
                Build {showBuild ? '\u25B2' : '\u25BC'}
              </button>

              {showBuild && (
                <div className="space-y-1 pl-2">
                  {Object.entries(BUILD_COSTS).map(([type, cost]) => (
                    <button key={type}
                      onClick={() => {
                        if (type === 'cannon' || type === 'mast' || type === 'lifePeg') {
                          if (selectedShip) onBuild(type, selectedShip.id);
                          else alert('Select a ship on the board first!');
                        } else {
                          onBuild(type);
                        }
                      }}
                      disabled={!canAfford(cost)}
                      className="w-full text-left bg-pirate-dark/50 border border-pirate-tan/10 rounded px-3 py-1.5
                                 text-xs hover:border-pirate-tan/30 transition disabled:opacity-40 disabled:cursor-not-allowed
                                 flex items-center justify-between">
                      <span className="text-white capitalize font-medium">{type === 'lifePeg' ? 'Life Peg' : type === 'plunderPoint' ? 'Plunder Point' : type}</span>
                      <span className="flex items-center gap-1.5">
                        {Object.entries(cost).filter(([, v]) => v > 0).map(([r, v]) => (
                          <span key={r} className="flex items-center gap-0.5">
                            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: RESOURCE_META[r]?.color }} />
                            <span className="text-pirate-tan/70">{v}</span>
                          </span>
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Trade */}
          {turnPhase === 'perform_actions' && (
            <>
              <button onClick={() => setShowTrade(!showTrade)}
                className="w-full bg-pirate-brown border border-pirate-tan/30 text-pirate-tan
                           py-1.5 rounded text-sm hover:border-pirate-gold transition">
                Trade {showTrade ? '\u25B2' : '\u25BC'}
              </button>

              {showTrade && (
                <div className="bg-pirate-dark/50 rounded p-2 space-y-2">
                  <select value={tradeTarget} onChange={(e) => setTradeTarget(e.target.value)}
                    className="w-full bg-pirate-dark border border-pirate-tan/30 rounded px-2 py-1 text-xs text-white">
                    <option value="">Select player...</option>
                    {tradeablePlayers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>

                  {tradeablePlayers.length === 0 && (
                    <p className="text-[10px] text-red-400">No players are close enough to trade with.</p>
                  )}

                  <div className="text-[10px] text-green-400">You give:</div>
                  <div className="grid grid-cols-4 gap-1">
                    {Object.keys(tradeOffer).map(r => (
                      <div key={r} className="text-center">
                        <div className="text-[10px] font-bold" style={{ color: RESOURCE_META[r]?.color }}>{RESOURCE_META[r]?.label}</div>
                        <input type="number" min="0" max={resources[r]} value={tradeOffer[r]}
                          onChange={(e) => setTradeOffer(prev => ({ ...prev, [r]: parseInt(e.target.value) || 0 }))}
                          className="w-full bg-pirate-dark border border-pirate-tan/20 rounded text-center text-xs py-0.5 text-white" />
                      </div>
                    ))}
                  </div>

                  <div className="text-[10px] text-red-400">You want:</div>
                  <div className="grid grid-cols-4 gap-1">
                    {Object.keys(tradeRequest).map(r => (
                      <div key={r} className="text-center">
                        <div className="text-[10px] font-bold" style={{ color: RESOURCE_META[r]?.color }}>{RESOURCE_META[r]?.label}</div>
                        <input type="number" min="0" value={tradeRequest[r]}
                          onChange={(e) => setTradeRequest(prev => ({ ...prev, [r]: parseInt(e.target.value) || 0 }))}
                          className="w-full bg-pirate-dark border border-pirate-tan/20 rounded text-center text-xs py-0.5 text-white" />
                      </div>
                    ))}
                  </div>

                  <button onClick={submitTrade} disabled={!tradeTarget}
                    className="w-full bg-green-700 text-white py-1 rounded text-xs hover:bg-green-600 disabled:opacity-40">
                    Propose Trade
                  </button>
                </div>
              )}
            </>
          )}

          {/* Merchant Trade */}
          {turnPhase === 'perform_actions' && gameState.atMerchant && (
            <>
              <button onClick={() => setShowMerchant(!showMerchant)}
                className="w-full bg-pirate-brown border border-yellow-600/50 text-pirate-gold
                           py-1.5 rounded text-sm hover:border-yellow-500 transition">
                Merchant Trade {showMerchant ? '\u25B2' : '\u25BC'}
              </button>

              {showMerchant && (
                <div className="bg-pirate-dark/50 rounded p-2 space-y-2">
                  <p className="text-[10px] text-pirate-tan/70">Give 2 resources, receive 1 of your choice.</p>

                  <div className="text-[10px] text-green-400">You receive:</div>
                  <select value={merchantReceive} onChange={(e) => setMerchantReceive(e.target.value)}
                    className="w-full bg-pirate-dark border border-pirate-tan/30 rounded px-2 py-1 text-xs text-white">
                    {Object.entries(RESOURCE_META).map(([r, meta]) => (
                      <option key={r} value={r}>{meta.label}</option>
                    ))}
                  </select>

                  <div className="text-[10px] text-red-400">You give (must total 2):</div>
                  <div className="grid grid-cols-4 gap-1">
                    {Object.keys(EMPTY_RESOURCES).map(r => (
                      <div key={r} className="text-center">
                        <div className="text-[10px] font-bold" style={{ color: RESOURCE_META[r]?.color }}>{RESOURCE_META[r]?.label}</div>
                        <input type="number" min="0" max={resources[r] || 0} value={merchantGive[r]}
                          onChange={(e) => setMerchantGive(prev => ({ ...prev, [r]: parseInt(e.target.value) || 0 }))}
                          className="w-full bg-pirate-dark border border-pirate-tan/20 rounded text-center text-xs py-0.5 text-white" />
                      </div>
                    ))}
                  </div>

                  <div className="text-[10px] text-pirate-tan/60 text-right">
                    Selected: {merchantGiveTotal} / 2
                  </div>

                  <button onClick={submitMerchantTrade} disabled={merchantGiveTotal !== 2}
                    className="w-full bg-yellow-600 text-white py-1 rounded text-xs font-bold
                               hover:bg-yellow-500 disabled:opacity-40 disabled:cursor-not-allowed transition">
                    Trade with Merchant
                  </button>
                </div>
              )}
            </>
          )}

          {/* Treaty */}
          {turnPhase === 'perform_actions' && (
            <>
              <button onClick={() => setShowTreaty(!showTreaty)}
                className="w-full bg-pirate-brown border border-pirate-tan/30 text-pirate-tan
                           py-1.5 rounded text-sm hover:border-pirate-gold transition">
                Treaty {showTreaty ? '\u25B2' : '\u25BC'}
              </button>

              {showTreaty && (
                <div className="bg-pirate-dark/50 rounded p-2 space-y-2">
                  <p className="text-[10px] text-pirate-tan/70">Propose a treaty (bribe) to another player.</p>

                  <select value={treatyTarget} onChange={(e) => setTreatyTarget(e.target.value)}
                    className="w-full bg-pirate-dark border border-pirate-tan/30 rounded px-2 py-1 text-xs text-white">
                    <option value="">Select player...</option>
                    {otherPlayers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>

                  <div className="text-[10px] text-green-400">You offer:</div>
                  <div className="grid grid-cols-4 gap-1">
                    {Object.keys(EMPTY_RESOURCES).map(r => (
                      <div key={r} className="text-center">
                        <div className="text-[10px] font-bold" style={{ color: RESOURCE_META[r]?.color }}>{RESOURCE_META[r]?.label}</div>
                        <input type="number" min="0" max={resources[r] || 0} value={treatyOffer[r]}
                          onChange={(e) => setTreatyOffer(prev => ({ ...prev, [r]: parseInt(e.target.value) || 0 }))}
                          className="w-full bg-pirate-dark border border-pirate-tan/20 rounded text-center text-xs py-0.5 text-white" />
                      </div>
                    ))}
                  </div>

                  <button onClick={submitTreaty} disabled={!treatyTarget}
                    className="w-full bg-indigo-700 text-white py-1 rounded text-xs font-bold
                               hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition">
                    Propose Treaty
                  </button>
                </div>
              )}
            </>
          )}

          {/* End Turn */}
          {turnPhase === 'perform_actions' && (
            <button onClick={onEndTurn}
              disabled={!!gameState.pendingAttack || !!gameState.pendingCombatReroll}
              className="w-full bg-red-800 hover:bg-red-700 text-white py-2 rounded text-sm transition mt-2
                         disabled:opacity-40 disabled:cursor-not-allowed">
              End Turn
            </button>
          )}
        </div>
      )}

      {/* ══════ Not your turn ══════ */}
      {!isMyTurn && phase === 'gameplay' && (
        <div className="text-center text-pirate-tan/50 text-sm py-4">
          Waiting for {gameState.players[gameState.currentPlayerId]?.name}...
        </div>
      )}

      {/* ══════ Game Over ══════ */}
      {phase === 'game_over' && (
        <div className="text-center py-4">
          <h2 className="font-pirate text-2xl text-pirate-gold mb-2">Game Over!</h2>
          <p className="text-white">
            {gameState.players[gameState.winner]?.name} wins!
          </p>
        </div>
      )}
    </div>
  );
}
