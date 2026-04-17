import { useState } from 'react';
import { usePlayerContext } from '../App';

const API_URL = import.meta.env.PROD ? '' : 'http://localhost:3001';

export default function BugReportButton() {
  const { playerInfo } = usePlayerContext();
  const [showModal, setShowModal] = useState(false);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  async function handleSubmit() {
    if (!description.trim()) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch(`${API_URL}/api/bugs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim(), playerName: playerInfo?.name }),
      });
      if (!res.ok) throw new Error('Server error');
      setFeedback('Bug report sent! Thank you.');
      setDescription('');
      setTimeout(() => { setShowModal(false); setFeedback(null); }, 1500);
    } catch {
      setFeedback('Error sending report. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancel() {
    setShowModal(false);
    setDescription('');
    setFeedback(null);
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="fixed top-3 left-[195px] z-[100] bg-pirate-brown border border-pirate-tan/30
                   text-pirate-tan hover:text-pirate-gold hover:border-pirate-gold/50
                   px-2.5 py-1 rounded text-[10px] font-pirate transition shadow-lg shadow-black/40"
      >
        Report a Bug
      </button>

      {showModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50">
          <div className="bg-pirate-brown border border-pirate-tan/30 p-5 rounded-lg shadow-lg
                          shadow-black/50 w-full max-w-sm mx-4">
            <h3 className="text-pirate-gold font-pirate text-lg mb-2">Report a Bug</h3>
            <p className="text-pirate-tan/70 text-xs mb-1">
              Describe your bug as thoroughly as possible.
            </p>
            <p className="text-pirate-tan/50 text-[10px] mb-3 italic leading-snug">
              Tip: these reports are handed to an AI to diagnose. The more
              detail you give — exact steps, what you expected, what actually
              happened, and the room code if you remember it — the better
              it can fix it.
            </p>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Steps to reproduce / what you expected / what happened..."
              rows={6}
              maxLength={2000}
              autoFocus
              className="w-full bg-pirate-dark border border-pirate-tan/20 rounded px-3 py-2
                         text-sm text-white placeholder-gray-600 focus:outline-none
                         focus:border-pirate-tan/40 resize-none"
            />
            {feedback && (
              <p className={`text-xs mt-1 ${feedback.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>
                {feedback}
              </p>
            )}
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleSubmit}
                disabled={!description.trim() || submitting}
                className="flex-1 bg-green-700 hover:bg-green-600 text-white py-1.5 rounded text-sm
                           disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {submitting ? 'Sending...' : 'Submit'}
              </button>
              <button
                onClick={handleCancel}
                className="flex-1 bg-red-700 hover:bg-red-600 text-white py-1.5 rounded text-sm transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
