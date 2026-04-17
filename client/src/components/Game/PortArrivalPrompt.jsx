// Pops up when the local player's ship docks at a port.
// Shows contextual actions (attack, merchant trade, trade with owner, build)
// as quick shortcuts. Dismissible.

export default function PortArrivalPrompt({
  ship,
  gameState,
  myPlayer,
  emit,
  onDismiss,
  onOpenMerchant,
  onOpenTrade,
  onOpenBuild,
}) {
  if (!ship || !gameState) return null;

  const tile = gameState.board?.[ship.position.row]?.[ship.position.col];
  if (!tile || tile.type !== 'port') return null;

  const isMerchant = !!tile.isMerchant;
  const island = tile.portOf ? gameState.islands?.[tile.portOf] : null;
  const ownerId = island?.owner;
  const owner = ownerId ? gameState.players?.[ownerId] : null;
  const ownedByMe = ownerId && ownerId === myPlayer?.id;
  const ownedByOther = !!ownerId && !ownedByMe;
  const unowned = !isMerchant && island && !ownerId;

  // Heading text
  let headline;
  let subtitle;
  if (isMerchant) {
    headline = 'Merchant Port';
    subtitle = 'Trade resources at the bank (2 → 1) or with any other player.';
  } else if (ownedByMe) {
    headline = 'Your Island';
    subtitle = 'Trade with other docked players or build from your stockpile.';
  } else if (ownedByOther) {
    headline = `${owner?.name ?? 'Enemy'}'s Island`;
    subtitle = `${island.skulls}-skull defense. Attack to conquer, or trade with ${owner?.name ?? 'the owner'}.`;
  } else if (unowned) {
    headline = 'Unclaimed Island';
    subtitle = `${island.skulls}-skull defense. Attack to claim it as your own.`;
  } else {
    headline = 'Docked';
    subtitle = 'Actions available in the panel.';
  }

  async function handleAttack() {
    if (!island) return;
    await emit('attack-island', { shipId: ship.id, islandId: island.id });
    onDismiss();
  }

  return (
    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40
                    bg-pirate-brown/95 border border-pirate-gold/50 px-4 py-3 rounded-lg shadow-lg
                    shadow-black/50 max-w-sm w-80 pointer-events-auto">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">⚓</span>
            <h3 className="text-pirate-gold font-pirate text-base">{headline}</h3>
          </div>
          <p className="text-pirate-tan/70 text-[11px] mb-2">{subtitle}</p>
        </div>
        <button
          onClick={onDismiss}
          className="text-pirate-tan/40 hover:text-pirate-tan text-base leading-none px-1"
          aria-label="Dismiss"
        >✕</button>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-1">
        {(unowned || ownedByOther) && (
          <button
            onClick={handleAttack}
            className="flex-1 min-w-[100px] bg-red-700 hover:bg-red-600 text-white py-1.5 rounded text-xs font-bold transition
                       border border-red-500/50">
            ⚔️ Attack ({island.skulls} 💀)
          </button>
        )}
        {isMerchant && (
          <button
            onClick={() => { onOpenMerchant?.(); onDismiss(); }}
            className="flex-1 min-w-[100px] bg-yellow-700 hover:bg-yellow-600 text-white py-1.5 rounded text-xs font-bold transition">
            💰 Merchant Trade
          </button>
        )}
        {(isMerchant || ownedByMe || ownedByOther) && (
          <button
            onClick={() => { onOpenTrade?.(); onDismiss(); }}
            className="flex-1 min-w-[100px] bg-green-700 hover:bg-green-600 text-white py-1.5 rounded text-xs font-bold transition">
            🤝 Trade
          </button>
        )}
        <button
          onClick={() => { onOpenBuild?.(); onDismiss(); }}
          className="flex-1 min-w-[100px] bg-pirate-brown border border-pirate-tan/30 text-pirate-tan hover:border-pirate-gold py-1.5 rounded text-xs transition">
          🔨 Build
        </button>
      </div>
    </div>
  );
}
