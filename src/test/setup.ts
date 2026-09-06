// FASE UX POS (Requerimiento 9): extiende `expect` de Vitest con los
// matchers de @testing-library/jest-dom (toHaveFocus, toBeInTheDocument,
// toBeDisabled, etc.) para todas las pruebas de componentes. Archivo
// nuevo, exclusivo de pruebas -- no participa en el build de producción.
import '@testing-library/jest-dom/vitest';
