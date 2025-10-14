// api/index.js (الكود الكامل المعدّل لإصلاح 404/500 - serverless function في Vercel)
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import Joi from 'joi';
import fetch from 'node-fetch';

dotenv.config();

const app = express();

// Middleware
app.use(cors({ origin: '*' }));  // مفتوح للاختبار؛ غيّره لأمان في الإنتاج
app.use(express.json({ limit: '10mb' }));  // للـ body الكبير
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Multer for file uploads
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });  // حد 10MB

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://projectAdmin:StrongPassword123@new1.ilh0xhl.mongodb.net/?retryWrites=true&w=majority&appName=new1')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Mongoose Model for Projects
const projectSchema = new mongoose.Schema({
  description: { type: String, required: true },
  images: [{ type: String }], // base64 strings
  files: { type: Object, required: true }, // JSON of generated files
  chatHistory: [{ role: String, parts: Object }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

projectSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const Project = mongoose.model('Project', projectSchema);

// Validation Schemas
const generateSchema = Joi.object({
  description: Joi.string().min(1).required()
});

const reviewSchema = Joi.object({
  reviewDescription: Joi.string().min(1).required()
});

// API Keys (move to env in production)
const apiKeys = [
  'AIzaSyB7YsXWxDR_gMuJxM_lUnnsTPLigRoZtNo',
  'AIzaSyAKKVaFDNI-vAID-YkO8PZHSWvc7lpEC2Q',
  'AIzaSyAsXOob95lBdc8elPZiGIOzpCzrUc8fsoA',
  'AIzaSyDbGevRolkcWYWB3KjqeUu3OTP-qiQeKfQ',
  'AIzaSyAd0fPFV10UV55r1gsdX7PEsq4AEezyCNo',
  'AIzaSyAgrKwUUDAmEvzv4RdRIjeM_EXwp7boeD0',
  'AIzaSyBkCkL3G1MbwfGHb5J0VGAre1xeiLgTjb4',
  'AIzaSyAJer3irweMRnTehNU-32z5eY3r0ZZ0i8M',
  'AIzaSyBTveIEA8Z2umCkbRB2jq1dUzVd0ZjM8cs',
  'AIzaSyAke6c4O121mTu2PCrzF_FZauZ4lJEUYN4',
  'AIzaSyBWsFdVBMQOmex5ysL91FtcQ7Jf4qO82mY',
  'AIzaSyCPFIa1zl41K_m_p-1geCRRU4IusXOO-l4',
  'AIzaSyB-kMsT1eCjJfgIMkg5CJVmNj8_HFgImZs',
  'AIzaSyBCcj064Kl_c_ibBPQTW13GwDV1vYherSk',
  'AIzaSyB-sIRHLVJ7KR6laXuIOxN_u6rrz7_wKSU'
];

// Helper: Call Gemini API
async function callGemini(promptParts, usedKeyIndex = 0) {
  const key = apiKeys[usedKeyIndex];
  if (!key) throw new Error('No API keys available');

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: promptParts }] })
  });

  if (!response.ok) {
    if (usedKeyIndex < apiKeys.length - 1) {
      return callGemini(promptParts, usedKeyIndex + 1);
    }
    throw new Error(`API call failed: ${response.statusText}`);
  }

  const data = await response.json();
  if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
    throw new Error('Invalid response from API');
  }

  return { text: data.candidates[0].content.parts[0].text, usedKeyIndex };
}

// Helper: Clean and parse JSON response
function parseProjectJSON(text) {
  let cleaned = text
    .replace(/```json\s*/g, '')
    .replace(/\s*```/g, '')
    .trim();

  let match = cleaned.match(/\{[\s\S]*\}/);
  if (match) cleaned = match[0];

  while (cleaned.includes('}') && !cleaned.includes('{')) cleaned = cleaned.replace(/}/g, '');

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`JSON parse error: ${e.message}`);
  }
}

// Log for all requests
app.use((req, res, next) => {
  console.log(`Request: ${req.method} ${req.path} - Full URL: ${req.url}`);
  next();
});

// POST /api/generate
app.post('/', upload.array('images'), async (req, res) => {
  try {
    console.log('POST / hit! Path:', req.path);
    console.log('Body:', req.body);
    console.log('Files count:', req.files?.length || 0);

    const { error } = generateSchema.validate({ description: req.body.description });
    if (error) return res.status(400).json({ error: error.details[0].message });

    const images = req.files
      ? req.files.map(file => `data:${file.mimetype};base64,${file.buffer.toString('base64')}`)
      : [];

    let userParts = [];

    if (images.length > 0) {
      images.forEach(img => {
        userParts.push({
          inlineData: {
            mimeType: img.split(';')[0].split(':')[1],
            data: img.split(',')[1]
          }
        });
      });
      userParts.push({
        text: `بناءً على التصميم في الصور المرفوعة، أنشئ أو حدث مشروع React كامل بناءً على هذا الوصف، مع الحفاظ على الربط بين الملفات والمكونات (استخدم imports وReact Router إذا لزم الأمر). 

الهيكل المطلوب للمشروع:
react-project/
│
├── public/
│   └── index.html
│
├── src/
│   ├── assets/         # Images, fonts, icons
│   ├── components/     # Reusable components (Button, Navbar, etc)
│   ├── contexts/       # React context providers for global state
│   ├── hooks/          # Custom React hooks
│   ├── pages/          # Page-level components (Home, About, Profile, etc)
│   ├── services/       # API calls and external service logic
│   ├── utils/          # Utility functions
│   ├── styles/         # Application-wide and component CSS
│   ├── config/         # Configuration and environment variables
│   ├── App.js
│   ├── index.js
│   └── reportWebVitals.js
│
├── .env                # Environment variables
├── .gitignore
├── package.json
└── README.md 

- استخدم المجلدات التالية داخل src:
  - components: احفظ المكونات القابلة لإعادة الاستخدام هنا.
  - pages: ضع مكونات الصفحات العلوية هنا (Home, About, Profile, إلخ).
  - hooks: أضف hooks مخصصة لـ React.
  - contexts: لمزودي السياق وإدارة الحالة العالمية.
  - services: استدعاءات API والمنطق الخارجي.
  - utils: وظائف مساعدة عامة.
  - assets: ملفات ثابتة مثل الصور، الأيقونات، الخطوط.
  - styles: ملفات CSS/Tailwind العالمية والمشتركة.
  - config: ملفات التكوين والبيئة.

- الملفات الرئيسية:
  - src/App.js أو App.jsx: المكون الرئيسي للتطبيق، استخدم React Router للتنقل إذا لزم.
  - src/index.js أو index.jsx: نقطة الدخول، قم بتضمين React.StrictMode و reportWebVitals.
  - src/reportWebVitals.js: ملف لقياس الأداء.

- الملفات في الجذر:
  - .env لمتغيرات البيئة.
  - package.json للتبعيات (شمل react, react-dom, react-router-dom, react-scripts كـ dependencies، وأضف scripts: {"start": "react-scripts start", "build": "react-scripts build", "test": "react-scripts test", "eject": "react-scripts eject"}).
  - .gitignore (استبعد node_modules، .env، build).
  - README.md مع تعليمات التشغيل.

- رتب كل مكون في مجلد خاص به داخل components إذا كان له أنماط، اختبارات، أو ملفات منطق خاصة.
- استخدم تجنب التداخل الزائد للحفاظ على الهيكل سهل التنقل.
- استخدم useState و useEffect في المكونات المناسبة.
- ضمن أن جميع الـ imports موجودة وصالحة؛ إذا كان مكون مفقود، أضف placeholder بسيط مثل function Placeholder() { return <div>Placeholder</div>; }.
- ضمن دعم UTF-8 كامل للنصوص العربية.

أضف تعليقات واضحة في ملفات الكود لتوجيه المطورين حول استخدام المجلدات، غرض المكون، والوظيفة.

نفذ تقنيات التصميم المتجاوب:
- استخدم استعلامات وسائط CSS، flexbox، أو grid.
- اعتمد نهجًا يبدأ بالهواتف المحمولة (mobile-first).
- اجعل المكونات تتكيف مع أحجام الشاشات المختلفة.
- ضمن أن الواجهة تتكيف تلقائيًا مع أي طلب من المستخدم حول الاستجابة.

أرجع النتيجة كـ JSON object فقط، بدون أي نص إضافي أو markdown أو شرح. ابدأ مباشرة بـ { وانتهِ بـ }. حيث كل مفتاح هو مسار الملف (مثل 'src/App.js') والقيمة هي محتوى الملف كسلسلة نصية. تأكد من أن محتوى كل ملف هو سلسلة نصية، حتى للملفات JSON مثل package.json؛ قدمها كـ JSON string صالح، وليس كائن JS. ضمن أن المشروع كامل (مع package.json، index.js، reportWebVitals.js، إلخ) وقابل للتشغيل: ${req.body.description}. لا تضف أي نص خارج الـ JSON.`
      });
    } else {
      userParts = [{
        text: `أنشئ أو حدث مشروع React كامل بناءً على هذا الوصف، مع الحفاظ على الربط بين الملفات والمكونات (استخدم imports وReact Router إذا لزم الأمر). 

الهيكل المطلوب للمشروع:
react-project/
│
├── public/
│   └── index.html
│
├── src/
│   ├── assets/         # Images, fonts, icons
│   ├── components/     # Reusable components (Button, Navbar, etc)
│   ├── contexts/       # React context providers for global state
│   ├── hooks/          # Custom React hooks
│   ├── pages/          # Page-level components (Home, About, Profile, etc)
│   ├── services/       # API calls and external service logic
│   ├── utils/          # Utility functions
│   ├── styles/         # Application-wide and component CSS
│   ├── config/         # Configuration and environment variables
│   ├── App.js
│   ├── index.js
│   └── reportWebVitals.js
│
├── .env                # Environment variables
├── .gitignore
├── package.json
└── README.md 

- استخدم المجلدات التالية داخل src:
  - components: احفظ المكونات القابلة لإعادة الاستخدام هنا.
  - pages: ضع مكونات الصفحات العلوية هنا (Home, About, Profile, إلخ).
  - hooks: أضف hooks مخصصة لـ React.
  - contexts: لمزودي السياق وإدارة الحالة العالمية.
  - services: استدعاءات API والمنطق الخارجي.
  - utils: وظائف مساعدة عامة.
  - assets: ملفات ثابتة مثل الصور، الأيقونات، الخطوط.
  - styles: ملفات CSS/Tailwind العالمية والمشتركة.
  - config: ملفات التكوين والبيئة.

- الملفات الرئيسية:
  - src/App.js أو App.jsx: المكون الرئيسي للتطبيق، استخدم React Router للتنقل إذا لزم.
  - src/index.js أو index.jsx: نقطة الدخول، قم بتضمين React.StrictMode و reportWebVitals.
  - src/reportWebVitals.js: ملف لقياس الأداء.

- الملفات في الجذر:
  - .env لمتغيرات البيئة.
  - package.json للتبعيات (شمل react, react-dom, react-router-dom, react-scripts كـ dependencies، وأضف scripts: {"start": "react-scripts start", "build": "react-scripts build", "test": "react-scripts test", "eject": "react-scripts eject"}).
  - .gitignore (استبعد node_modules، .env، build).
  - README.md مع تعليمات التشغيل.

- رتب كل مكون في مجلد خاص به داخل components إذا كان له أنماط، اختبارات، أو ملفات منطق خاصة.
- استخدم تجنب التداخل الزائد للحفاظ على الهيكل سهل التنقل.
- استخدم useState و useEffect في المكونات المناسبة.
- ضمن أن جميع الـ imports موجودة وصالحة؛ إذا كان مكون مفقود، أضف placeholder بسيط مثل function Placeholder() { return <div>Placeholder</div>; }.
- ضمن دعم UTF-8 كامل للنصوص العربية.

أضف تعليقات واضحة في ملفات الكود لتوجيه المطورين حول استخدام المجلدات، غرض المكون، والوظيفة.

نفذ تقنيات التصميم المتجاوب:
- استخدم استعلامات وسائط CSS، flexbox، أو grid.
- اعتمد نهجًا يبدأ بالهواتف المحمولة (mobile-first).
- اجعل المكونات تتكيف مع أحجام الشاشات المختلفة.
- ضمن أن الواجهة تتكيف تلقائيًا مع أي طلب من المستخدم حول الاستجابة.

أرجع النتيجة كـ JSON object فقط، بدون أي نص إضافي أو markdown أو شرح. ابدأ مباشرة بـ { وانتهِ بـ }. حيث كل مفتاح هو مسار الملف (مثل 'src/App.js') والقيمة هي محتوى الملف كسلسلة نصية. تأكد من أن محتوى كل ملف هو سلسلة نصية، حتى للملفات JSON مثل package.json؛ قدمها كـ JSON string صالح، وليس كائن JS. ضمن أن المشروع كامل (مع package.json، index.js، reportWebVitals.js، إلخ) وقابل للتشغيل: ${req.body.description}. لا تضف أي نص خارج الـ JSON.`
      }];
    }

    console.log('Calling Gemini API...');

    const { text, usedKeyIndex } = await callGemini(userParts);

    console.log('Gemini response received. Parsing JSON...');

    let projectFiles = parseProjectJSON(text);

    // Normalize contents to strings
    for (const [path, content] of Object.entries(projectFiles)) {
      if (typeof content === 'object') {
        projectFiles[path] = JSON.stringify(content, null, 2);
      }
    }

    // Check required files
    const required = ['package.json', 'src/index.js', 'src/App.js'];
    const missing = required.filter(f => !projectFiles[f]);
    if (missing.length > 0) {
      throw new Error(`Missing required files: ${missing.join(', ')}`);
    }

    // Save to DB
    const project = new Project({
      description: req.body.description,
      images,
      files: projectFiles,
      chatHistory: []
    });
    await project.save();

    console.log('Project saved to DB. Sending response...');

    res.status(201).json({
      projectId: project._id,
      files: projectFiles,
      message: `Generated successfully using API key ${usedKeyIndex + 1}`
    });
  } catch (error) {
    console.error('Error in /generate:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/projects/:id/review (full path)
app.post('/projects/:id/review', async (req, res) => {
  try {
    console.log('POST /projects/:id/review hit! Path:', req.path);

    const { error } = reviewSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const currentJson = JSON.stringify(project.files);
    const promptParts = [{
      text: `راجع وأصلح هذا مشروع React بناءً على الوصف: ${req.body.reviewDescription}. 

المشروع الحالي: ${currentJson}

اتبع نفس الهيكل السابق، وأصلح الأخطاء في الـ imports، الـ JSON، UTF-8، والملفات المفقودة. ضمن أن جميع الملفات الأساسية موجودة (package.json, src/index.js, src/App.js, src/reportWebVitals.js). 

أرجع JSON object فقط مع الملفات المحدثة.`
    }];

    const { text, usedKeyIndex } = await callGemini(promptParts);

    let updatedFiles = parseProjectJSON(text);

    // Normalize
    for (const [path, content] of Object.entries(updatedFiles)) {
      if (typeof content === 'object') {
        updatedFiles[path] = JSON.stringify(content, null, 2);
      }
    }

    // Check required
    const required = ['package.json', 'src/index.js', 'src/App.js'];
    const missing = required.filter(f => !updatedFiles[f]);
    if (missing.length > 0) {
      throw new Error(`Missing required files after review: ${missing.join(', ')}`);
    }

    // Update DB
    project.files = updatedFiles;
    project.updatedAt = Date.now();
    await project.save();

    res.status(200).json({
      files: updatedFiles,
      message: `Reviewed successfully using API key ${usedKeyIndex + 1}`
    });
  } catch (error) {
    console.error('Error in /projects/:id/review:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/projects/:id (full path)
app.get('/projects/:id', async (req, res) => {
  try {
    console.log('GET /projects/:id hit! Path:', req.path);
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ files: project.files });
  } catch (error) {
    console.error('Error in /projects/:id:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/projects (full path)
app.get('/projects', async (req, res) => {
  try {
    console.log('GET /projects hit! Path:', req.path);
    const projects = await Project.find().sort({ createdAt: -1 }).limit(10);
    res.json(projects.map(p => ({ id: p._id, description: p.description, createdAt: p.createdAt })));
  } catch (error) {
    console.error('Error in /projects:', error);
    res.status(500).json({ error: error.message });
  }
});

// 404 handler for API routes
app.use((req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ error: 'API route not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`Error middleware hit: ${req.method} ${req.path}`, err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// ✅ تكوين خاص لـ Vercel (عشان يتعامل مع Express من غير مشاكل)
export const config = {
  api: {
    bodyParser: false,
  },
};

// ✅ التصدير بالشكل اللي Vercel بيحتاجه
export default app;

