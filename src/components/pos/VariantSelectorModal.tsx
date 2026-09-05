import React, { useState, useEffect } from 'react';
import { Product, ProductVariant } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import { X, Check, ShoppingBag, AlertCircle } from 'lucide-react';
import { sounds } from '../../utils/soundEffects';
import { toDisplayableImageUrl } from '../../utils/imageUrl';

interface VariantSelectorModalProps {
  product: Product | null;
  onClose: () => void;
  onAddToCart: (product: Product, variant: ProductVariant, quantity: number) => void;
}

export const VariantSelectorModal: React.FC<VariantSelectorModalProps> = ({
  product,
  onClose,
  onAddToCart,
}) => {
  if (!product) return null;

  // Extract available unique colors and sizes from variants
  const variantsList = product.variantes || [];
  const availableColors = Array.from(new Set(variantsList.map((v) => v.color)));
  const availableSizes = Array.from(new Set(variantsList.map((v) => v.talla)));

  const [selectedColor, setSelectedColor] = useState<string>(availableColors[0] || '');
  const [selectedSize, setSelectedSize] = useState<string>(availableSizes[0] || '');
  const [quantity, setQuantity] = useState<number>(1);

  // Find corresponding variant
  const currentVariant = variantsList.find(
    (v) => v.color === selectedColor && v.talla === selectedSize
  );

  const stock = currentVariant ? currentVariant.stock : 0;
  const isAvailable = stock > 0;

  useEffect(() => {
    setQuantity(1);
  }, [selectedColor, selectedSize]);

  const handleAdd = () => {
    if (!currentVariant || !isAvailable) return;
    sounds.playBeep();
    onAddToCart(product, currentVariant, quantity);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-[#FAF8F4] border border-[#E4DDD2] rounded-3xl max-w-md w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="p-4 border-b border-[#E4DDD2] flex items-center justify-between bg-[#F6F1E8]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#2F2A25] text-[#E8DCC8] flex items-center justify-center">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#2F2A25] leading-tight">{product.nombre}</h3>
              <p className="text-[11px] text-[#756E65]">SKU: {product.sku}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#756E65] hover:text-[#2F2A25] hover:bg-[#E8DCC8]/50 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Price & Image Preview */}
          <div className="flex gap-4 items-center bg-white p-3 rounded-2xl border border-[#E4DDD2]">
            {product.imagenUrl && (
              <img
                src={toDisplayableImageUrl(product.imagenUrl)}
                alt={product.nombre}
                className="w-16 h-16 rounded-xl object-cover border border-[#E4DDD2]"
              />
            )}
            <div>
              <span className="text-xs text-[#756E65] uppercase tracking-wider font-semibold">Precio de Venta</span>
              <p className="text-xl font-bold text-[#2F2A25]">{formatCurrency(product.precio)}</p>
              {product.precioEspecial && (
                <p className="text-xs text-emerald-700 font-medium">
                  Oferta VIP: {formatCurrency(product.precioEspecial)}
                </p>
              )}
            </div>
          </div>

          {/* Color Selection */}
          <div>
            <label className="block text-xs font-bold text-[#2F2A25] mb-2 uppercase tracking-wider">
              1. Seleccionar Color: <span className="text-[#756E65] font-normal normal-case">{selectedColor}</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {availableColors.map((color) => {
                const isSelected = selectedColor === color;
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setSelectedColor(color)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-[#2F2A25] text-[#FAF8F4] border-[#2F2A25] shadow-xs'
                        : 'bg-white text-[#2F2A25] border-[#E4DDD2] hover:bg-[#F6F1E8]'
                    }`}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 text-[#E8DCC8]" />}
                    <span>{color}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Size Selection */}
          <div>
            <label className="block text-xs font-bold text-[#2F2A25] mb-2 uppercase tracking-wider">
              2. Seleccionar Talla: <span className="text-[#756E65] font-normal normal-case">{selectedSize}</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {availableSizes.map((size) => {
                const isSelected = selectedSize === size;
                // Check variant stock for this size and current selected color
                const v = (product.variantes || []).find((item) => item.color === selectedColor && item.talla === size);
                const sCount = v ? v.stock : 0;

                return (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setSelectedSize(size)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-[#2F2A25] text-[#FAF8F4] border-[#2F2A25]'
                        : sCount > 0
                        ? 'bg-white text-[#2F2A25] border-[#E4DDD2] hover:bg-[#F6F1E8]'
                        : 'bg-zinc-100 text-zinc-400 border-zinc-200 line-through'
                    }`}
                  >
                    <span>{size}</span>
                    <span
                      className={`text-[10px] px-1 rounded font-normal ${
                        isSelected ? 'text-[#E8DCC8]' : sCount > 0 ? 'text-[#756E65]' : 'text-zinc-400'
                      }`}
                    >
                      ({sCount})
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Stock Indicator */}
          <div
            className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
              isAvailable
                ? stock <= (product.stockMinimo || 3)
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                {isAvailable
                  ? `Inventario disponible: ${stock} unidad(es)`
                  : 'Variante agotada en este color y talla'}
              </span>
            </div>
            {currentVariant && (
              <span className="font-mono text-[10px] text-[#756E65]">{currentVariant.sku}</span>
            )}
          </div>

          {/* Quantity Selector */}
          {isAvailable && (
            <div className="flex items-center justify-between pt-2">
              <label className="text-xs font-bold text-[#2F2A25] uppercase tracking-wider">Cantidad:</label>
              <div className="flex items-center border border-[#E4DDD2] bg-white rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="px-3 py-1.5 text-sm font-bold text-[#2F2A25] hover:bg-[#F6F1E8] transition"
                >
                  -
                </button>
                <span className="px-4 py-1.5 text-xs font-bold text-[#2F2A25] border-x border-[#E4DDD2]">
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity(Math.min(stock, quantity + 1))}
                  className="px-3 py-1.5 text-sm font-bold text-[#2F2A25] hover:bg-[#F6F1E8] transition"
                >
                  +
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#E4DDD2] bg-[#F6F1E8] flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-xl text-xs font-medium text-[#756E65] bg-white border border-[#E4DDD2] hover:bg-zinc-50 transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!isAvailable || !currentVariant}
            onClick={handleAdd}
            className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-[#FAF8F4] bg-[#2F2A25] hover:bg-[#403932] disabled:bg-zinc-300 disabled:cursor-not-allowed transition shadow-sm flex items-center justify-center gap-2"
          >
            <ShoppingBag className="w-4 h-4" />
            <span>Agregar al Carrito</span>
          </button>
        </div>
      </div>
    </div>
  );
};
