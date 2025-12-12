type LoadingListener = (pendingCount: number) => void;

let pendingCount = 0;
const listeners = new Set<LoadingListener>();

const notify = () => {
  for (const listener of listeners) listener(pendingCount);
};

export const loadingTracker = {
  start() {
    pendingCount += 1;
    notify();
  },
  stop() {
    pendingCount = Math.max(0, pendingCount - 1);
    notify();
  },
  getCount() {
    return pendingCount;
  },
  subscribe(listener: LoadingListener) {
    listeners.add(listener);
    listener(pendingCount);
    return () => {
      listeners.delete(listener);
    };
  },
};
