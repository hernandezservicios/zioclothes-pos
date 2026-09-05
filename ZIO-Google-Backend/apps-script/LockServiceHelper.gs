/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: LockServiceHelper.gs
 * Description: Concurrency isolation using LockService to guarantee atomic transactions.
 */

const LockServiceHelper = {
  /**
   * Executes a callback within an exclusive script lock.
   * Ensures atomic execution across concurrent users.
   * Always releases the lock in a finally block.
   *
   * @param {number} timeoutMs - Max wait time in milliseconds (default 15000)
   * @param {Function} callback - Transaction function to execute
   * @returns {*} Return value of the callback
   */
  runWithLock(timeoutMs, callback) {
    const timeout = timeoutMs || CONFIG.LOCK_TIMEOUT_MS;
    const lock = LockService.getScriptLock();

    try {
      const acquired = lock.tryLock(timeout);
      if (!acquired) {
        throw new Error(
          'CONCURRENCY_TIMEOUT: El sistema está ocupado procesando otra transacción crítica simultánea. Por favor, reintente en unos segundos.'
        );
      }

      return callback();
    } finally {
      try {
        lock.releaseLock();
      } catch (e) {
        // Lock might have already expired or was released
      }
    }
  }
};
