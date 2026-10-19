/** Trang kết quả PayOS chuyển khách về sau khi thanh toán / huỷ (mở trong trình duyệt điện thoại). */

export type PaymentResultState = 'success' | 'pending' | 'cancelled' | 'failed' | 'unknown';

export interface PaymentResultView {
  state: PaymentResultState;
  orderCode: string;
  amount: number | null;
  typeLabel: string | null;
}

/** Link mở lại app PBMS (đăng ký trong AndroidManifest / Info.plist). */
export function appDeepLink(view: PaymentResultView): string {
  const q = new URLSearchParams({ status: view.state, orderCode: view.orderCode });
  return `pbms://payment-result?${q.toString()}`;
}

const TEXT: Record<PaymentResultState, { title: string; body: string; color: string; icon: string }> = {
  success: {
    title: 'Thanh toán thành công',
    body: 'PBMS đã nhận tiền. Quay lại ứng dụng để xem vé, mã ra cổng hoặc số dư ví.',
    color: '#047857',
    icon: '✓',
  },
  pending: {
    title: 'Đang chờ xác nhận',
    body: 'Ngân hàng chưa báo kết quả. Quay lại ứng dụng, trạng thái sẽ tự cập nhật sau ít phút.',
    color: '#B45309',
    icon: '…',
  },
  cancelled: {
    title: 'Đã huỷ thanh toán',
    body: 'Bạn chưa bị trừ tiền. Có thể thanh toán lại trong ứng dụng bất cứ lúc nào.',
    color: '#64748B',
    icon: '×',
  },
  failed: {
    title: 'Thanh toán không thành công',
    body: 'Giao dịch đã hết hạn hoặc bị từ chối. Bạn chưa bị trừ tiền; hãy thử lại trong ứng dụng.',
    color: '#DC2626',
    icon: '!',
  },
  unknown: {
    title: 'Không tìm thấy giao dịch',
    body: 'Liên kết không còn hợp lệ. Quay lại ứng dụng để kiểm tra thanh toán của bạn.',
    color: '#64748B',
    icon: '?',
  },
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function renderPaymentResultPage(view: PaymentResultView): string {
  const t = TEXT[view.state];
  const link = escapeHtml(appDeepLink(view));
  const rows = [
    view.typeLabel ? ['Nội dung', view.typeLabel] : null,
    view.amount != null ? ['Số tiền', `${Math.round(view.amount).toLocaleString('vi-VN')} đ`] : null,
    view.orderCode ? ['Mã đơn hàng', view.orderCode] : null,
  ]
    .filter((r): r is string[] => r !== null)
    .map(([k, v]) => `<div class="row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`)
    .join('');
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(t.title)} | PBMS</title>
<style>
  :root { --ink:#1E293B; --muted:#64748B; --line:#E2E8F0; --teal:#087B8C; --bg:#F8FAFC; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:var(--bg); color:var(--ink); font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; padding:16px; }
  main { width:100%; max-width:420px; background:#fff; border:1px solid var(--line); border-radius:20px; padding:28px 22px; text-align:center; }
  .badge { width:64px; height:64px; margin:0 auto 14px; border-radius:50%; display:flex; align-items:center; justify-content:center;
           font-size:32px; font-weight:700; color:#fff; background:${t.color}; }
  h1 { font-size:22px; margin:0 0 8px; }
  p { color:var(--muted); margin:0 0 18px; }
  .rows { border-top:1px solid var(--line); margin:0 0 20px; text-align:left; }
  .row { display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid var(--line); font-size:15px; }
  .row span { color:var(--muted); }
  a.btn { display:block; padding:14px; border-radius:14px; background:var(--teal); color:#fff; font-weight:600; text-decoration:none; }
  small { display:block; margin-top:14px; color:var(--muted); }
</style>
</head>
<body>
<main>
  <div class="badge" aria-hidden="true">${t.icon}</div>
  <h1>${escapeHtml(t.title)}</h1>
  <p>${escapeHtml(t.body)}</p>
  ${rows ? `<div class="rows">${rows}</div>` : ''}
  <a class="btn" href="${link}">Quay lại ứng dụng PBMS</a>
  <small>Nếu ứng dụng không tự mở, hãy mở PBMS trên điện thoại.</small>
</main>
<script>setTimeout(function () { location.href = ${JSON.stringify(appDeepLink(view))}; }, 1200);</script>
</body>
</html>`;
}
