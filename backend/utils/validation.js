export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 6;
}

export function hasRequiredFields(fields, required) {
  return required.every((field) => {
    const value = fields[field];
    return typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null && value !== '';
  });
}

export function validateDealInput(payload) {
  const errors = [];

  if (!payload.food_name || payload.food_name.trim() === '') errors.push('Food name is required.');
  if (!payload.shop_name || payload.shop_name.trim() === '') errors.push('Shop name is required.');
  if (!payload.category) errors.push('Category is required.');
  if (Number(payload.original_price) <= 0) errors.push('Original price must be greater than zero.');
  if (Number(payload.discounted_price) <= 0) errors.push('Sale price must be greater than zero.');
  if (Number(payload.discounted_price) > Number(payload.original_price)) errors.push('Sale price cannot exceed the original price.');
  if (Number(payload.quantity) <= 0) errors.push('Quantity must be greater than zero.');
  if (!payload.expires_at || new Date(payload.expires_at).getTime() <= Date.now()) errors.push('Expiry must be in the future.');

  return { valid: errors.length === 0, errors };
}
