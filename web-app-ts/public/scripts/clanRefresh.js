(function (root) {
    // Serialize refreshes and discard snapshots made obsolete by a newer event.
    function createClanRefreshQueue({ load, apply, isBusy, onError, schedule = setTimeout, cancel = clearTimeout }) {
        let revision = 0;
        let pending = false;
        let running = false;
        let stopped = false;
        let timer = null;

        function enqueue(delay) {
            if (!stopped && timer === null && !running) {
                timer = schedule(refresh, delay);
            }
        }

        async function refresh() {
            timer = null;
            if (stopped || !pending) return;
            if (isBusy()) {
                enqueue(500);
                return;
            }
            running = true;
            const requestedRevision = revision;
            let delay = 250;
            try {
                const snapshot = await load();
                if (!stopped && requestedRevision === revision && !isBusy()) {
                    apply(snapshot);
                    pending = false;
                }
            } catch (error) {
                if (!stopped) onError(error);
                delay = 3000;
            } finally {
                running = false;
                if (pending) enqueue(delay);
            }
        }

        return {
            request() {
                revision += 1;
                pending = true;
                enqueue(250);
            },
            stop() {
                stopped = true;
                if (timer !== null) cancel(timer);
            }
        };
    }

    if (typeof module === 'object' && module.exports) {
        module.exports = { createClanRefreshQueue };
    } else {
        root.createClanRefreshQueue = createClanRefreshQueue;
    }
})(typeof window === 'undefined' ? globalThis : window);
