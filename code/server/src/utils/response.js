// Định dạng response chuẩn — 04-api-contract.md mục 1.1.
export const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

export const okPaged = (res, data, meta) => res.json({ success: true, data, meta });

export const fail = (res, { status, code, message, details }) =>
  res.status(status).json({
    success: false,
    error: { code, message, ...(details !== undefined && { details }) },
  });
