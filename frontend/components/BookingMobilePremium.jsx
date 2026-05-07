import { useEffect, useMemo, useState } from "react";

const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

const fallbackAvatar =
  "https://images.unsplash.com/photo-1503951458645-643d53bfd90f?auto=format&fit=crop&w=400&q=80";

function formatKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function monthLabel(date) {
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Falha na requisicao");
  return data;
}

export default function BookingMobilePremium({ token, onBooked }) {
  const [barbers, setBarbers] = useState([]);
  const [services, setServices] = useState([]);
  const [selectedBarber, setSelectedBarber] = useState(null);
  const [selectedServices, setSelectedServices] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [availableSlots, setAvailableSlots] = useState([]);
  const [selectedTime, setSelectedTime] = useState(null);
  const [statusText, setStatusText] = useState("Carregando agenda...");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const days = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();

    const items = [];
    for (let i = 0; i < startOffset; i += 1) items.push(null);
    for (let d = 1; d <= totalDays; d += 1) items.push(new Date(year, month, d));
    return items;
  }, [currentMonth]);

  useEffect(() => {
    async function loadInitial() {
      try {
        const [barbersData, servicesData] = await Promise.all([
          apiJson("/api/barbers"),
          apiJson("/api/services"),
        ]);

        const enrichedBarbers = barbersData.map((b) => ({
          id: b.id,
          name: b.full_name,
          specialty: b.specialty || "Corte moderno e acabamento premium",
          avatar: b.photo_url || fallbackAvatar,
        }));

        setBarbers(enrichedBarbers);
        setServices(servicesData);

        if (enrichedBarbers.length) setSelectedBarber(enrichedBarbers[0].id);
        if (servicesData.length) setSelectedServices([servicesData[0].id]);
        setStatusText("Escolha barbeiro, data e horario.");
      } catch (error) {
        setStatusText(error.message);
      } finally {
        setLoadingInitial(false);
      }
    }

    loadInitial();
  }, []);

  useEffect(() => {
    async function loadSlots() {
      if (!selectedBarber || !selectedDate) return;
      try {
        setLoadingSlots(true);
        const date = formatKey(selectedDate);
        const data = await apiJson(
          `/api/appointments/available-slots?barberId=${selectedBarber}&date=${date}`
        );
        setAvailableSlots(data.slots || []);
        setSelectedTime(null);
      } catch (error) {
        setAvailableSlots([]);
        setStatusText(error.message);
      } finally {
        setLoadingSlots(false);
      }
    }

    loadSlots();
  }, [selectedBarber, selectedDate]);

  function goMonth(delta) {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }

  function toggleService(serviceId) {
    setSelectedServices((prev) => {
      if (prev.includes(serviceId)) return prev.filter((id) => id !== serviceId);
      return [...prev, serviceId];
    });
  }

  async function confirmBooking() {
    if (!token) return setStatusText("Faca login antes de agendar.");
    if (!selectedBarber || !selectedDate || !selectedTime || !selectedServices.length) {
      return setStatusText("Preencha barbeiro, servico, data e horario.");
    }

    try {
      setIsSubmitting(true);
      setStatusText("Confirmando seu horario...");
      const dateKey = formatKey(selectedDate);
      const scheduledStart = new Date(`${dateKey}T${selectedTime}:00`).toISOString();

      const result = await apiJson("/api/appointments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          barberId: selectedBarber,
          services: selectedServices,
          scheduledStart,
          notes: "Agendamento pelo app mobile premium",
        }),
      });

      setStatusText("Agendamento confirmado com sucesso.");
      onBooked?.(result);
    } catch (error) {
      setStatusText(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-sm rounded-3xl border border-amber-400/30 bg-zinc-950 p-4 text-zinc-100 shadow-[0_0_50px_rgba(217,119,6,0.15)]">
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-wide text-amber-300">Agendar Horario</h2>
        <p className="text-xs text-zinc-400">Experiencia premium, direto do celular</p>
      </div>

      <div className="mb-4 flex gap-3 overflow-x-auto pb-2">
        {loadingInitial
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={`sk-barber-${i}`} className="min-w-[160px] animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900 p-2">
                <div className="mb-2 h-20 w-full rounded-xl bg-zinc-800" />
                <div className="mb-1 h-3 w-24 rounded bg-zinc-700" />
                <div className="h-2 w-28 rounded bg-zinc-800" />
              </div>
            ))
          : barbers.map((barber) => {
              const active = selectedBarber === barber.id;
              return (
                <button
                  key={barber.id}
                  type="button"
                  onClick={() => setSelectedBarber(barber.id)}
                  className={`min-w-[160px] rounded-2xl border p-2 text-left transition-all duration-300 ${
                    active
                      ? "border-amber-300 bg-amber-400/10"
                      : "border-zinc-800 bg-zinc-900 hover:border-amber-500/50"
                  }`}
                >
                  <img
                    src={barber.avatar}
                    alt={barber.name}
                    className="mb-2 h-20 w-full rounded-xl object-cover"
                  />
                  <p className="text-sm font-semibold text-amber-100">{barber.name}</p>
                  <p className="text-[11px] text-zinc-400">{barber.specialty}</p>
                </button>
              );
            })}
      </div>

      <div className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-3">
        <p className="mb-2 text-xs font-medium text-zinc-300">Escolha servicos</p>
        <div className="grid grid-cols-1 gap-2">
          {loadingInitial
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={`sk-service-${i}`} className="h-10 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900" />
              ))
            : services.map((service) => {
                const active = selectedServices.includes(service.id);
                return (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => toggleService(service.id)}
                    className={`rounded-xl border px-3 py-2 text-left text-xs transition-all ${
                      active
                        ? "border-amber-300 bg-amber-300/15 text-amber-100"
                        : "border-zinc-700 bg-zinc-900 text-zinc-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>{service.name}</span>
                      <span className="font-semibold text-amber-300">R$ {Number(service.price).toFixed(2)}</span>
                    </div>
                  </button>
                );
              })}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => goMonth(-1)}
            className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition hover:border-amber-400 hover:text-amber-200"
          >
            Anterior
          </button>
          <p className="text-sm font-medium capitalize text-amber-200">{monthLabel(currentMonth)}</p>
          <button
            type="button"
            onClick={() => goMonth(1)}
            className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition hover:border-amber-400 hover:text-amber-200"
          >
            Proximo
          </button>
        </div>

        <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] text-zinc-500">
          {weekDays.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {days.map((day, idx) => {
            if (!day) return <span key={`empty-${idx}`} />;
            const key = formatKey(day);
            const active = key === formatKey(selectedDate);

            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedDate(day)}
                className={`relative h-9 rounded-lg text-xs transition-all duration-300 ${
                  active
                    ? "bg-amber-400 text-zinc-950"
                    : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                }`}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-medium text-zinc-300">Horarios disponiveis</p>
        <div className="grid grid-cols-3 gap-2">
          {loadingSlots ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={`sk-slot-${i}`} className="h-9 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900" />
            ))
          ) : availableSlots.length ? (
            availableSlots.map((time) => (
              <button
                key={time}
                type="button"
                onClick={() => setSelectedTime(time)}
                className={`rounded-xl border px-2 py-2 text-xs font-semibold transition-all duration-300 ${
                  selectedTime === time
                    ? "border-amber-300 bg-amber-300/15 text-amber-200"
                    : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-amber-500/60"
                }`}
              >
                {time}
              </button>
            ))
          ) : (
            <p className="col-span-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-center text-xs text-zinc-500">
              Sem horarios para esta data.
            </p>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={confirmBooking}
        disabled={isSubmitting || !selectedBarber || !selectedTime || !selectedServices.length}
        className="mt-5 w-full rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-300 px-4 py-3 text-sm font-bold text-zinc-950 transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSubmitting ? "Processando..." : "Confirmar Agendamento"}
      </button>

      <p className="mt-3 text-center text-xs text-zinc-400">{statusText}</p>
    </section>
  );
}
