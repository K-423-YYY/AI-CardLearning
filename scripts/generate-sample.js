const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('../app/vendor/jszip.min.js');

const now = '2026-08-01 09:00:00';
const date = '2026-08-01';

const content = `# Python 快速入门

## 变量与类型
Python 是动态类型语言，变量不需要声明类型。常用类型包括 int、float、str、bool、list、dict。

## 函数
使用 def 定义函数，return 返回结果。函数参数可以有默认值。

## 类与对象
使用 class 定义类，__init__ 是构造方法，self 指向实例本身。
`;

const data = {
  profile: { nickname: '示例用户', daily_card_limit: 5 },
  zones: [
    {
      id: 1,
      user_id: 1,
      name: '示例学习区',
      status: '进行中',
      created_at: now,
      updated_at: now
    }
  ],
  files: [
    {
      id: 1,
      zone_id: 1,
      filename: 'Python快速入门.txt',
      content,
      created_at: now
    }
  ],
  cards: [
    {
      id: 1,
      file_id: 1,
      title: '动态类型',
      question: 'Python 中变量的类型是在什么时候确定的？',
      option_a: '声明变量时',
      option_b: '运行时根据值确定',
      option_c: '编译时确定',
      option_d: '永远不确定',
      answer: 'B',
      explanation: 'Python 是动态类型语言，变量的类型在运行时根据赋值确定。',
      label: '必考',
      block_name: '变量与类型',
      difficulty: '易',
      sort_order: 1,
      status: '待学',
      wrong_count: 0,
      level_no: 1,
      created_at: now
    },
    {
      id: 2,
      file_id: 1,
      title: '函数默认参数',
      question: '下面哪个写法可以定义带默认参数的函数？',
      option_a: 'def f(a=1):',
      option_b: 'def f(a := 1):',
      option_c: 'def f(a -> 1):',
      option_d: 'def f(default a):',
      answer: 'A',
      explanation: '默认参数写在参数名后并用等号赋值。',
      label: '常考',
      block_name: '函数',
      difficulty: '中',
      sort_order: 2,
      status: '待学',
      wrong_count: 0,
      level_no: 1,
      created_at: now
    },
    {
      id: 3,
      file_id: 1,
      title: '__init__ 方法',
      question: 'Python 类的构造方法名称是？',
      option_a: 'constructor',
      option_b: '__init__',
      option_c: 'initialize',
      option_d: 'build',
      answer: 'B',
      explanation: '__init__ 是类的初始化方法，创建实例时自动调用。',
      label: '加分',
      block_name: '类与对象',
      difficulty: '难',
      sort_order: 3,
      status: '待学',
      wrong_count: 0,
      level_no: 2,
      created_at: now
    }
  ],
  records: [],
  zone_settings: [
    {
      id: 1,
      zone_id: 1,
      daily_limit: 5,
      level_count: 3,
      sort_mode: 'easy_to_hard',
      updated_at: now
    }
  ],
  levels: [
    {
      id: 1,
      zone_id: 1,
      level_no: 1,
      name: '',
      level_type: '新学',
      day_no: 1,
      new_count: 2,
      daily_limit: 5,
      status: '待闯关',
      completed_at: null,
      created_at: now
    },
    {
      id: 2,
      zone_id: 1,
      level_no: 2,
      name: '',
      level_type: '新学',
      day_no: 2,
      new_count: 1,
      daily_limit: 5,
      status: '待闯关',
      completed_at: null,
      created_at: now
    },
    {
      id: 3,
      zone_id: 1,
      level_no: 3,
      name: '',
      level_type: '复习',
      day_no: 3,
      new_count: 0,
      daily_limit: 5,
      status: '待闯关',
      completed_at: null,
      created_at: now
    }
  ],
  level_cards: [
    { id: 'lc:1:1:1', zone_id: 1, level_no: 1, card_id: 1, role: '新学', created_at: now },
    { id: 'lc:1:1:2', zone_id: 1, level_no: 1, card_id: 2, role: '新学', created_at: now },
    { id: 'lc:1:2:3', zone_id: 1, level_no: 2, card_id: 3, role: '新学', created_at: now },
    { id: 'lc:1:3:1', zone_id: 1, level_no: 3, card_id: 1, role: '复习', created_at: now },
    { id: 'lc:1:3:2', zone_id: 1, level_no: 3, card_id: 2, role: '复习', created_at: now },
    { id: 'lc:1:3:3', zone_id: 1, level_no: 3, card_id: 3, role: '复习', created_at: now }
  ],
  review_schedule: [],
  daily_tasks: [],
  checkins: []
};

const manifest = {
  format_version: 1,
  app_version: '0.1.0',
  exported_at: date + 'T09:00:00+08:00',
  export_type: 'zone',
  source_app: 'ai-learn-local'
};

const zip = new JSZip();
zip.file('manifest.json', JSON.stringify(manifest, null, 2));
zip.file('data.json', JSON.stringify(data, null, 2));
zip.file('files/1_Python快速入门.txt', content);

const outDir = path.join(__dirname, '..', 'samples');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, '示例学习区.zip');
zip.generateAsync({ type: 'nodebuffer' }).then((buffer) => {
  fs.writeFileSync(out, buffer);
  console.log('sample written:', out, buffer.length, 'bytes');
});
