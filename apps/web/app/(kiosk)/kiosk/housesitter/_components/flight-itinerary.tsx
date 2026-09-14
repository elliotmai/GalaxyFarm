"use client";

interface Flight {
  readonly flightNumber: string;
  readonly source: string;
  readonly destination: string;
  readonly departure: string;
  readonly arrival: string;
}

function formatFlightTime(timeStr: string): string {
  // Extract time and timezone from format like "Tue, Sep 15, 2026 – 9:21 AM CT"
  const match = timeStr.match(/(\d{1,2}:\d{2}\s(?:AM|PM))\s(CT|ET|MT|PT)/);
  if (match) {
    return `${match[1]} ${match[2]}`;
  }
  return timeStr;
}

export function FlightItinerary({ flights }: { readonly flights: readonly Flight[] }) {
  if (flights.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-ink">Travel Schedule</h2>
        <span className="text-xs text-muted">{flights.length} flights</span>
      </header>

      <div className="space-y-3">
        {flights.map((flight, index) => (
          <div
            key={`${flight.flightNumber}-${index}`}
            className="flex flex-col gap-2 border-l-4 border-primary bg-panel p-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-lg font-bold text-ink">{flight.flightNumber}</span>
              <span className="text-xs text-muted">Flight {index + 1}</span>
            </div>

            <div className="flex items-center gap-4 text-sm">
              <div className="flex-1">
                <div className="text-xs font-medium uppercase text-muted">From</div>
                <div className="font-medium text-ink">{flight.source}</div>
              </div>
              <div className="text-muted">→</div>
              <div className="flex-1">
                <div className="text-xs font-medium uppercase text-muted">To</div>
                <div className="font-medium text-ink">{flight.destination}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-edge pt-2 text-sm">
              <div>
                <div className="text-xs font-medium uppercase text-muted">Departs</div>
                <div className="font-mono text-ink">{formatFlightTime(flight.departure)}</div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase text-muted">Arrives</div>
                <div className="font-mono text-ink">{formatFlightTime(flight.arrival)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
