import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CustomersView } from './CustomersView';

/**
 * AUDITORÍA -- MODALES DE CLIENTE, PRODUCTO Y VARIANTES, Objetivo 1.
 *
 * "Registrar Nuevo Cliente" (CustomersView.tsx) debe iniciar con TODOS
 * sus 8 campos vacíos -- nunca con "Límite de Crédito"/"Plazo de Pago"
 * ya rellenos con los valores de ejemplo (30000/30) que antes vivían en
 * `useState`/`handleOpenCreate` como VALOR real en vez de placeholder.
 */

const showToast = vi.fn();
const refreshCustomers = vi.fn();
const customersSave = vi.fn();

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ settings: { simboloMoneda: 'RD$' }, hasPermission: () => true }),
}));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../context/DataStoreContext', () => ({
  useDataStore: () => ({
    customers: [],
    customersLoading: false,
    customersError: null,
    customersStale: false,
    refreshCustomers,
  }),
}));
vi.mock('../../services/customersApi', () => ({
  customersApi: { save: (...args: any[]) => customersSave(...args) },
}));

beforeEach(() => {
  vi.clearAllMocks();
  customersSave.mockResolvedValue({ success: true, message: 'OK' });
});
afterEach(() => cleanup());

function openNewCustomerModal() {
  fireEvent.click(screen.getByRole('button', { name: /Nuevo Cliente/i }));
}

describe('CustomersView -- "Registrar Nuevo Cliente" inicia completamente vacío (Objetivo 1)', () => {
  it('TEST 1: los 8 campos inician vacíos -- nunca con 30000/30 ya rellenos', () => {
    render(<CustomersView />);
    openNewCustomerModal();

    expect((screen.getByPlaceholderText('Ej. Juan') as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText('Ej. Pérez') as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText('402-XXXXXXX-X') as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText('809-XXX-XXXX') as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText('correo@ejemplo.com') as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText('Calle, Sector, Número...') as HTMLInputElement).value).toBe('');

    // "Límite de Crédito" (placeholder "0.00") y "Plazo de Pago"
    // (placeholder "30") -- el bug real: useState(30000)/useState(30)
    // los mostraba ya rellenos con esos números como VALOR, nunca como
    // placeholder.
    expect((screen.getByPlaceholderText('0.00') as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText('30') as HTMLInputElement).value).toBe('');
  });

  it('TEST 2: escribir datos, cerrar sin guardar (Cancelar) y reabrir "Nuevo Cliente" debe estar vacío otra vez', () => {
    render(<CustomersView />);
    openNewCustomerModal();

    fireEvent.change(screen.getByPlaceholderText('Ej. Juan'), { target: { value: 'Cliente Sin Guardar' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '99999' } });

    fireEvent.click(screen.getByRole('button', { name: /Cancelar/i }));
    openNewCustomerModal();

    expect((screen.getByPlaceholderText('Ej. Juan') as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText('0.00') as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText('30') as HTMLInputElement).value).toBe('');
  });

  it('después de guardar un cliente, abrir "Nuevo Cliente" otra vez crea un formulario nuevo y vacío', async () => {
    render(<CustomersView />);
    openNewCustomerModal();

    fireEvent.change(screen.getByPlaceholderText('Ej. Juan'), { target: { value: 'Primer Cliente' } });
    fireEvent.change(screen.getByPlaceholderText('809-XXX-XXXX'), { target: { value: '809-000-0000' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '15000' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar Cliente/i }));

    await vi.waitFor(() => expect(customersSave).toHaveBeenCalledTimes(1));

    openNewCustomerModal();
    expect((screen.getByPlaceholderText('Ej. Juan') as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText('0.00') as HTMLInputElement).value).toBe('');
  });
});
