interface MetricsState {
  requestsTotal: number;
  requestsByStatusClass: {
    "2xx": number;
    "3xx": number;
    "4xx": number;
    "5xx": number;
    other: number;
  };
  requestDurationMsTotal: number;
  requestDurationMsMax: number;
}

const state: MetricsState = {
  requestsTotal: 0,
  requestsByStatusClass: {
    "2xx": 0,
    "3xx": 0,
    "4xx": 0,
    "5xx": 0,
    other: 0
  },
  requestDurationMsTotal: 0,
  requestDurationMsMax: 0
};

function statusClass(status: number): keyof MetricsState["requestsByStatusClass"] {
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return "other";
}

export function recordRequest(status: number, durationMs: number) {
  state.requestsTotal += 1;
  state.requestsByStatusClass[statusClass(status)] += 1;
  state.requestDurationMsTotal += durationMs;
  if (durationMs > state.requestDurationMsMax) {
    state.requestDurationMsMax = durationMs;
  }
}

export function metricsSnapshot() {
  const avgDurationMs =
    state.requestsTotal === 0 ? 0 : state.requestDurationMsTotal / state.requestsTotal;
  return {
    requestsTotal: state.requestsTotal,
    requestsByStatusClass: {
      ...state.requestsByStatusClass
    },
    requestDurationMsAvg: Number(avgDurationMs.toFixed(3)),
    requestDurationMsMax: Number(state.requestDurationMsMax.toFixed(3))
  };
}
