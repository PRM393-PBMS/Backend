export type OtpEmailPurpose = 'registration' | 'password-reset';

interface OtpEmailTemplateInput {
  readonly brandName: string;
  readonly brandColor: string;
  readonly otp: string;
  readonly purpose: OtpEmailPurpose;
}

interface OtpEmailTemplate {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

interface OtpEmailCopy {
  readonly subjectPrefix: string;
  readonly heading: string;
  readonly description: string;
}

export function createOtpEmailTemplate({
  brandName,
  brandColor,
  otp,
  purpose,
}: OtpEmailTemplateInput): OtpEmailTemplate {
  const copy = getCopy(purpose);
  const subject = `${copy.subjectPrefix} | ${brandName}`;
  const preheader = `Mã xác thực có hiệu lực trong 10 phút.`;
  const safeBrandName = escapeHtml(brandName);
  const safeOtp = escapeHtml(otp);
  const safeHeading = escapeHtml(copy.heading);
  const safeDescription = escapeHtml(copy.description);

  return {
    subject,
    text: `${copy.heading}\n\n${copy.description}\n\nMã xác thực: ${otp}\nMã có hiệu lực trong 10 phút.\n\nKhông chia sẻ mã này với bất kỳ ai. Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email hoặc trả lời email này để được hỗ trợ.`,
    html: `<!doctype html>
<html lang="vi" dir="ltr">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f1f5f9;color:#172033;font-family:Arial,Helvetica,sans-serif;">
    <div lang="vi" dir="ltr">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f1f5f9;">
        <tr>
          <td align="center" style="padding:32px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:16px;overflow:hidden;">
              <tr>
                <td style="padding:28px 32px;background-color:${brandColor};color:#ffffff;">
                  <p style="margin:0;font-size:15px;line-height:22px;font-weight:700;">${safeBrandName}</p>
                  <h1 style="margin:8px 0 0;font-size:26px;line-height:34px;color:#ffffff;">${safeHeading}</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:32px;">
                  <p style="margin:0;font-size:16px;line-height:25px;color:#172033;">${safeDescription}</p>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:28px 0;background-color:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;">
                    <tr>
                      <td align="center" style="padding:22px 16px;">
                        <p style="margin:0 0 10px;font-size:13px;line-height:20px;font-weight:700;letter-spacing:1px;color:#334155;">MÃ XÁC THỰC</p>
                        <p style="margin:0;font-family:Consolas,'Courier New',monospace;font-size:32px;line-height:40px;font-weight:700;letter-spacing:7px;color:#115e59;">${safeOtp}</p>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:0;font-size:16px;line-height:25px;color:#334155;"><strong>Mã có hiệu lực trong 10 phút.</strong> Không chia sẻ mã này với bất kỳ ai.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 32px;background-color:#f8fafc;border-top:1px solid #e2e8f0;">
                  <p style="margin:0;font-size:14px;line-height:21px;color:#475569;">Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email hoặc trả lời email này để được hỗ trợ.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  </body>
</html>`,
  };
}

function getCopy(purpose: OtpEmailPurpose): OtpEmailCopy {
  return purpose === 'registration'
    ? {
        subjectPrefix: 'Xác nhận đăng ký tài khoản',
        heading: 'Xác nhận đăng ký',
        description: 'Dùng mã bên dưới để hoàn tất đăng ký tài khoản của bạn.',
      }
    : {
        subjectPrefix: 'Xác nhận đặt lại mật khẩu',
        heading: 'Đặt lại mật khẩu',
        description: 'Dùng mã bên dưới để xác nhận yêu cầu đặt lại mật khẩu.',
      };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character];
  });
}
