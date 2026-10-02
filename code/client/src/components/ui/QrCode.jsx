import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * Mã QR dạng SVG vẽ ngay trên trình duyệt (nội dung không rời khỏi máy). Luôn vẽ ĐEN TRÊN NỀN TRẮNG kèm viền trắng:
 * đầu đọc QR cần độ tương phản cao, không đọc được QR sáng-trên-tối của giao diện nền tối.
 * `value` chỉ là chuỗi cố định do server cấp (vd "CINEMIND:K7Q2M9XA").
 */
export default function QrCode({ value, size = 224, label }) {
  const [svg, setSvg] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    QRCode.toString(value, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then((out) => { if (alive) setSvg(out); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [value]);

  if (failed) return <p role="alert" className="text-sm text-red-300">Không tạo được mã QR. Hãy đọc mã vé cho nhân viên.</p>;
  return (
    <div
      role="img" aria-label={label ?? `Mã QR ${value}`} data-testid="qr"
      style={{ width: size, height: size }}
      className="overflow-hidden rounded-xl bg-white [&>svg]:h-full [&>svg]:w-full"
      // SVG do thư viện qrcode sinh từ chuỗi `value` của chính ứng dụng, không chứa dữ liệu người dùng nhập tùy ý.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
