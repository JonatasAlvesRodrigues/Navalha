import { useState } from "react";
import BookingMobilePremium from "./BookingMobilePremium";

export default function BookingMobilePremiumExample() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("joao@email.com");
  const [password, setPassword] = useState("cliente123");
  const [message, setMessage] = useState("Faça login para liberar o agendamento.");

  async function handleLogin(event) {
    event.preventDefault();
    setMessage("Autenticando...");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha no login");

      setToken(data.token);
      setMessage(`Logado como ${data.user.fullName}.`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 p-4">
      <div className="mx-auto mb-4 w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-zinc-100">
        <form onSubmit={handleLogin} className="space-y-2">
          <input
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
          />
          <input
            type="password"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Senha"
          />
          <button className="w-full rounded-lg bg-amber-400 px-3 py-2 text-sm font-bold text-zinc-900">
            Entrar
          </button>
        </form>
        <p className="mt-2 text-xs text-zinc-400">{message}</p>
      </div>

      <BookingMobilePremium
        token={token}
        onBooked={(result) => setMessage(`Agendamento #${result.id} confirmado.`)}
      />
    </div>
  );
}
