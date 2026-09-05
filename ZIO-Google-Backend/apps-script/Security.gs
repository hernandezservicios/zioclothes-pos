/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: Security.gs
 * Description: Cryptographic security, password hashing (SHA-256 + salt), session token management, and RBAC.
 */

const Security = {
  /**
   * Generates a random alphanumeric salt string.
   * @param {number} length - Salt length (default 16)
   * @returns {string}
   */
  generateSalt(length = 16) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*';
    let salt = '';
    for (let i = 0; i < length; i++) {
      salt += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return salt;
  },

  /**
   * Generates a SHA-256 hash from password + salt.
   * Never stores plain text passwords.
   * @param {string} password - Raw password
   * @param {string} salt - Cryptographic salt
   * @returns {string} Hex string of SHA-256
   */
  hashPassword(password, salt) {
    if (!password || !salt) {
      throw new Error('[Security] Password y salt son requeridos para generar hash.');
    }
    const raw = password + '::' + salt;
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
    return digest.map(byte => {
      const v = (byte < 0 ? byte + 256 : byte).toString(16);
      return v.length === 1 ? '0' + v : v;
    }).join('');
  },

  /**
   * Verifies a raw password against stored hash and salt.
   * Supports backward compatibility with standard initial demo passwords (admin123, etc.)
   * @param {string} inputPassword
   * @param {string} storedHash
   * @param {string} storedSalt
   * @returns {boolean}
   */
  verifyPassword(inputPassword, storedHash, storedSalt) {
    if (!inputPassword) return false;
    
    // If salt is present, use strict SHA-256 verification
    if (storedSalt) {
      const computedHash = this.hashPassword(inputPassword, storedSalt);
      return computedHash === storedHash;
    }

    // Fallback for initial unhashed seed passwords if any
    return inputPassword === storedHash;
  },

  /**
   * Creates an authenticated session token for a user.
   * Token is stored in CacheService with TTL (up to 6 hours) and registered in script properties.
   * @param {Object} user - User record without sensitive fields
   * @returns {string} sessionToken
   */
  createSession(user) {
    const token = 'ZIO-SESS-' + Utilities.getUuid() + '-' + Date.now().toString(36);
    const sessionData = {
      userId: user.id,
      usuario: user.usuario,
      nombre: user.nombre,
      apellido: user.apellido,
      rol: user.rol,
      correo: user.correo,
      createdAt: Date.now(),
      expiresAt: Date.now() + (CONFIG.SESSION_TTL_HOURS * 3600 * 1000)
    };

    // CacheService allows fast, distributed session checks across concurrent requests
    const cache = CacheService.getScriptCache();
    // CacheService TTL maximum is 21600 seconds (6 hours)
    cache.put(token, JSON.stringify(sessionData), 21600);

    return token;
  },

  /**
   * Validates a session token and returns the authenticated user context.
   * Throws if invalid or expired.
   * @param {string} token
   * @returns {Object} sessionData
   */
  validateSession(token) {
    if (!token || typeof token !== 'string' || token.trim() === '') {
      throw new Error('AUTH_REQUIRED: Se requiere un token de sesión válido.');
    }

    const cleanToken = token.trim();
    const cache = CacheService.getScriptCache();
    const cached = cache.get(cleanToken);

    if (!cached) {
      throw new Error('SESSION_EXPIRED: La sesión ha expirado o no es válida. Por favor inicie sesión nuevamente.');
    }

    try {
      const session = JSON.parse(cached);
      if (Date.now() > session.expiresAt) {
        cache.remove(cleanToken);
        throw new Error('SESSION_EXPIRED: La sesión ha expirado.');
      }
      return session;
    } catch (e) {
      cache.remove(cleanToken);
      throw new Error('SESSION_INVALID: Formato de sesión corrupto o no autorizado.');
    }
  },

  /**
   * Destroys an active session token (Logout).
   * @param {string} token
   */
  destroySession(token) {
    if (!token) return;
    const cache = CacheService.getScriptCache();
    cache.remove(token.trim());
  },

  /**
   * Verifies if a user has a specific permission code.
   * @param {Object} user - Session or user object
   * @param {string} permissionCode - Permission string
   * @returns {boolean}
   */
  hasPermission(user, permissionCode) {
    if (!user) return false;
    if (user.rol === 'ADMIN') return true;

    try {
      const rolesSheet = DbHelper.getSheet('Roles_Permisos');
      const roles = DbHelper.getAllRows('Roles_Permisos');
      const roleConfig = roles.find(r => r.rol === user.rol);
      if (!roleConfig || !roleConfig.permisos_json) return false;

      const permissions = JSON.parse(roleConfig.permisos_json);
      return Array.isArray(permissions) && permissions.includes(permissionCode);
    } catch (e) {
      Logger.log('[Security] Error checking permissions: ' + e.message);
      return false;
    }
  },

  /**
   * Asserts that a user has permission; throws 403 error if not.
   * @param {Object} user
   * @param {string} permissionCode
   */
  requirePermission(user, permissionCode) {
    if (!this.hasPermission(user, permissionCode)) {
      throw new Error(`FORBIDDEN: No tiene el permiso requerido '${permissionCode}' para realizar esta acción.`);
    }
  }
};
