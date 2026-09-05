/**
 * ZIO CLOTHES — Google Apps Script Backend
 * File: AuthController.gs
 * Description: Multi-user authentication, secure login, password management, and permission verification.
 */

const AuthController = {
  /**
   * Performs secure login, checks user status, verifies SHA-256 hash + salt,
   * creates an authenticated session token, and updates last access.
   *
   * @param {Object} data - { username, password }
   * @returns {Object} { success: true, sessionToken, user, permissions }
   */
  handleLogin(data) {
    if (!data || !data.username || !data.password) {
      throw new Error('VALIDATION_ERROR: Usuario y contraseña son requeridos.');
    }

    const inputUser = String(data.username).trim().toLowerCase();
    const inputPass = String(data.password).trim();

    const users = DbHelper.getAllRows('Usuarios');
    const user = users.find(
      u => String(u.usuario || '').toLowerCase() === inputUser ||
           String(u.correo || '').toLowerCase() === inputUser
    );

    if (!user) {
      AuditController.log(null, 'LOGIN_FAILED', 'AUTH', 'User', inputUser, `Intento fallido de login: usuario '${inputUser}' no existe`, '', 'FALLO');
      throw new Error('AUTH_FAILED: Credenciales incorrectas. Verifique su usuario y contraseña.');
    }

    if (user.estado === 'BLOQUEADO') {
      AuditController.log(user, 'LOGIN_BLOCKED', 'AUTH', 'User', user.id, `Intento de acceso de usuario bloqueado: ${user.usuario}`, '', 'FALLO');
      throw new Error('AUTH_BLOCKED: Esta cuenta ha sido bloqueada por seguridad. Contacte al administrador.');
    }

    if (user.estado === 'INACTIVO') {
      AuditController.log(user, 'LOGIN_INACTIVE', 'AUTH', 'User', user.id, `Intento de acceso de usuario inactivo: ${user.usuario}`, '', 'FALLO');
      throw new Error('AUTH_INACTIVE: La cuenta de usuario se encuentra inactiva.');
    }

    const isValid = Security.verifyPassword(inputPass, user.password_hash, user.password_salt);
    if (!isValid) {
      AuditController.log(user, 'LOGIN_FAILED', 'AUTH', 'User', user.id, `Contraseña incorrecta para usuario: ${user.usuario}`, '', 'FALLO');
      throw new Error('AUTH_FAILED: Credenciales incorrectas. Verifique su usuario y contraseña.');
    }

    // Update last access
    const nowStr = getNowFormatted();
    try {
      DbHelper.updateRowById('Usuarios', user.id, { ultimo_acceso: nowStr });
    } catch (e) {
      Logger.log('[Auth] No se pudo actualizar ultimo_acceso: ' + e.message);
    }

    // Get role permissions
    const roles = DbHelper.getAllRows('Roles_Permisos');
    const roleConfig = roles.find(r => r.rol === user.rol);
    let permissions = [];
    if (roleConfig && roleConfig.permisos_json) {
      try {
        permissions = typeof roleConfig.permisos_json === 'string' 
          ? JSON.parse(roleConfig.permisos_json) 
          : roleConfig.permisos_json;
      } catch (e) {
        permissions = [];
      }
    }

    // Create session token
    const safeUser = {
      id: user.id,
      usuario: user.usuario,
      nombre: user.nombre,
      apellido: user.apellido,
      correo: user.correo,
      telefono: user.telefono || '',
      rol: user.rol,
      estado: user.estado,
      avatar: user.avatar || ''
    };

    const sessionToken = Security.createSession(safeUser);
    AuditController.log(safeUser, 'LOGIN_SUCCESS', 'AUTH', 'User', safeUser.id, `Inicio de sesión exitoso: ${safeUser.nombre} (${safeUser.rol})`);

    return {
      success: true,
      sessionToken: sessionToken,
      user: safeUser,
      permissions: permissions
    };
  },

  /**
   * Validates active session token and returns fresh user data.
   * Used on page reload or app rehydration.
   * @param {string} token
   * @returns {Object} { success: true, user, permissions }
   */
  handleValidateSession(token) {
    const session = Security.validateSession(token);
    const user = DbHelper.findById('Usuarios', session.userId);

    if (!user || user.estado !== 'ACTIVO') {
      Security.destroySession(token);
      throw new Error('AUTH_INVALID: El usuario ya no se encuentra activo.');
    }

    const roles = DbHelper.getAllRows('Roles_Permisos');
    const roleConfig = roles.find(r => r.rol === user.rol);
    let permissions = [];
    if (roleConfig && roleConfig.permisos_json) {
      try {
        permissions = typeof roleConfig.permisos_json === 'string'
          ? JSON.parse(roleConfig.permisos_json)
          : roleConfig.permisos_json;
      } catch (e) {
        permissions = [];
      }
    }

    const safeUser = {
      id: user.id,
      usuario: user.usuario,
      nombre: user.nombre,
      apellido: user.apellido,
      correo: user.correo,
      telefono: user.telefono || '',
      rol: user.rol,
      estado: user.estado,
      avatar: user.avatar || ''
    };

    return {
      success: true,
      user: safeUser,
      permissions: permissions
    };
  },

  /**
   * Destroys the active session token.
   * @param {string} token
   * @param {Object} user
   * @returns {Object}
   */
  handleLogout(token, user) {
    Security.destroySession(token);
    if (user) {
      AuditController.log(user, 'LOGOUT', 'AUTH', 'User', user.id || user.userId, `Cierre de sesión de usuario ${user.nombre || user.usuario}`);
    }
    return { success: true, message: 'Sesión cerrada exitosamente.' };
  },

  /**
   * Returns all users (without passwords or salts).
   * @param {Object} data
   * @param {Object} user
   */
  handleListUsers(data, user) {
    Security.requirePermission(user, 'admin.usuarios');
    const raw = DbHelper.getAllRows('Usuarios');
    const safeUsers = raw.map(u => ({
      id: u.id,
      usuario: u.usuario,
      nombre: u.nombre,
      apellido: u.apellido,
      correo: u.correo,
      telefono: u.telefono || '',
      rol: u.rol,
      estado: u.estado,
      avatar: u.avatar || '',
      creado_en: u.creado_en,
      ultimo_acceso: u.ultimo_acceso
    }));

    return { success: true, users: safeUsers };
  },

  /**
   * Creates or updates a user account.
   * Generates salt and SHA-256 hash if password is provided.
   * @param {Object} data
   * @param {Object} currentUser
   */
  handleSaveUser(data, currentUser) {
    Security.requirePermission(currentUser, 'admin.usuarios');
    if (!data.usuario || !data.nombre || !data.rol) {
      throw new Error('VALIDATION_ERROR: Usuario, nombre y rol son obligatorios.');
    }

    return LockServiceHelper.runWithLock(CONFIG.LOCK_TIMEOUT_MS, () => {
      const cleanUsername = String(data.usuario).trim().toLowerCase();
      const cleanEmail = String(data.correo || `${cleanUsername}@zioclothes.com`).trim().toLowerCase();

      const existingUsers = DbHelper.getAllRows('Usuarios');
      const isDuplicate = existingUsers.find(
        u => (u.id !== data.id) &&
             (String(u.usuario).toLowerCase() === cleanUsername || String(u.correo).toLowerCase() === cleanEmail)
      );

      if (isDuplicate) {
        throw new Error('DUPLICATE_USER: El nombre de usuario o correo ya está registrado por otro empleado.');
      }

      if (data.id) {
        // Update user
        const existing = DbHelper.findById('Usuarios', data.id);
        if (!existing) throw new Error('NOT_FOUND: Usuario no encontrado.');

        const updates = {
          usuario: cleanUsername,
          nombre: data.nombre.trim(),
          apellido: (data.apellido || '').trim(),
          correo: cleanEmail,
          telefono: data.telefono || '',
          rol: data.rol,
          estado: data.estado || 'ACTIVO',
          avatar: data.avatar || ''
        };

        if (data.password && String(data.password).trim() !== '') {
          const salt = Security.generateSalt(16);
          updates.password_salt = salt;
          updates.password_hash = Security.hashPassword(String(data.password).trim(), salt);
        }

        DbHelper.updateRowById('Usuarios', data.id, updates);
        AuditController.log(currentUser, 'USER_UPDATED', 'AUTH', 'User', data.id, `Usuario ${cleanUsername} actualizado.`);
        return { success: true, message: 'Usuario actualizado exitosamente.', userId: data.id };
      } else {
        // Create new user
        const newId = Sequences.getNext('USR');
        const salt = Security.generateSalt(16);
        const pass = String(data.password || '123456').trim();
        const hash = Security.hashPassword(pass, salt);

        const newRow = {
          id: newId,
          usuario: cleanUsername,
          nombre: data.nombre.trim(),
          apellido: (data.apellido || '').trim(),
          correo: cleanEmail,
          telefono: data.telefono || '',
          rol: data.rol,
          estado: data.estado || 'ACTIVO',
          password_hash: hash,
          password_salt: salt,
          avatar: data.avatar || '',
          creado_en: getNowFormatted(),
          ultimo_acceso: ''
        };

        DbHelper.insertRow('Usuarios', newRow);
        AuditController.log(currentUser, 'USER_CREATED', 'AUTH', 'User', newId, `Usuario ${cleanUsername} creado con rol ${data.rol}.`);
        return { success: true, message: 'Usuario creado exitosamente.', userId: newId };
      }
    });
  }
};
