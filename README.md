# Social Inbox — صندوق الردود

نظام ردود آلي وصندوق وارد موحّد لفيسبوك وانستغرام وواتساب، مع لوحة تحكم (عربي/RTL).

## لوحة التحكم
الصندوق · المستخدمون · العملاء (Excel) · الإحصائيات · الاشتراكات · المسارات · البث · المعلّقون · الإعدادات · المشرفون (صلاحيات لكل موظف)

## التشغيل
```
npm install
npm start
```

## متغيرات البيئة (Render → Environment)
| المتغير | الوصف |
|---|---|
| DATABASE_URL | رابط Postgres |
| ADMIN_PASSWORD | كلمة مرور المدير الأساسي (المستخدم: admin) |
| SECRET | نص عشوائي لتوقيع الجلسات |
| VERIFY_TOKEN | نفس القيمة في إعداد Meta Webhook |
| FB_PAGE_TOKEN | Page Access Token (فيسبوك + انستغرام) |
| IG_USER_ID | معرّف حساب انستغرام Business |
| WA_TOKEN | WhatsApp Cloud API token |
| WA_PHONE_ID | معرّف رقم واتساب |

## Webhook
`https://YOUR-APP.onrender.com/webhook`
- Facebook Page: feed, messages
- Instagram: comments, messages
- WhatsApp: messages

فحص الصحة: `/health`
