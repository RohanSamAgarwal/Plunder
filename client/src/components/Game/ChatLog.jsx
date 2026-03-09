import { useState, useRef, useEffect } from 'react';

export default function ChatLog({ messages, emit }) {
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function send() {
    if (!input.trim()) return;
    emit('chat-message', { message: input.trim() });
    setInput('');
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-1 space-y-0.5">
        {messages.map((msg, i) => (
          <div key={i} className="text-xs">
            {msg.system ? (
              <span className="text-pirate-tan/40 italic">{msg.message}</span>
            ) : (
              <>
                <span className="text-pirate-gold">{msg.name}: </span>
                <span className="text-white/80">{msg.message}</span>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="p-2 flex gap-1">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type..."
          className="flex-1 bg-pirate-dark border border-pirate-tan/20 rounded px-2 py-1
                     text-xs text-white placeholder-gray-600 focus:outline-none focus:border-pirate-tan/40"
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button
          onClick={send}
          className="bg-pirate-sea text-white px-2 py-1 rounded text-xs hover:bg-pirate-sea/80"
        >
          ▶
        </button>
      </div>
    </div>
  );
}
