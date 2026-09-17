import React, { useEffect } from "react";
import { api } from "../services/api";
import {
  storeData,
  getPendingSubmissions,
} from "../services/offline";
import { toast } from "react-hot-toast";

// Syncs queued offline submissions whenever we're online
export function useSubmissionSync() {
  useEffect(() => {
    async function sync() {
      if (!navigator.onLine) return;
      const pending = await getPendingSubmissions();
      if (pending.length === 0) return;

      const remaining = [];
      for (const sub of pending) {
        try {
          await api.post(`/student/tests/${sub.testId}/submit`, sub.payload);
          toast.success("A queued submission synced to the server");
        } catch (err) {
          const msg = err.response?.data?.error;
          // Drop only if it's already been submitted; keep on other errors
          if (msg === "Already submitted") {
            continue;
          }
          remaining.push(sub);
        }
      }
      await storeData("pending_submissions", remaining);
    }

    sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, []);
}