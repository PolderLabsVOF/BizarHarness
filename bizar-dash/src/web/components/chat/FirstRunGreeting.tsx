// src/components/chat/FirstRunGreeting.tsx — first-run greeting with gradient text.

interface Props {
  userName: string;
}

export function FirstRunGreeting({ userName }: Props) {
  const name = userName.trim() || 'there';
  return (
    <div className="chat-greeting">
      <div>
        <span className="chat-greeting-hello">Hello, </span>
        <span className="chat-greeting-name">{name}.</span>
      </div>
      <div className="chat-greeting-subtitle">How can I help you today?</div>
    </div>
  );
}