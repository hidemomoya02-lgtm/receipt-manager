import React, { useState, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, query, orderBy } from 'firebase/firestore';
import * as XLSX from 'xlsx';

// Firebase設定（後で環境変数に移します）
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export default function App() {
  const [screen, setScreen] = useState('home');
  const [image, setImage] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState([]);
  const fileInputRef = useRef(null);

  const CLAUDE_API_KEY = process.env.REACT_APP_CLAUDE_API_KEY;

  // 画像をbase64に変換
  const toBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  // レシート解析
  const analyzeReceipt = async (file) => {
    setAnalyzing(true);
    try {
      const base64 = await toBase64(file);
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-5',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: file.type, data: base64 }
              },
              {
                type: 'text',
                text: `このレシートまたは領収書を解析してください。以下のJSON形式のみで返答してください。他の文章は不要です。
{
  "date": "YYYY-MM-DD形式の日付",
  "store": "店名・取引先",
  "amount_with_tax": 税込金額の数値,
  "amount_without_tax": 税抜金額の数値,
  "tax_amount": 消費税額の数値,
  "payment_method": "現金またはPayPayまたはクレジットカード",
  "account_title": "勘定科目（食料品費・消耗品費・交際費・水道光熱費・通信費・その他のいずれか）",
  "memo": "備考があれば"
}
日付が読み取れない場合は今日の日付、金額が読み取れない場合は0を入れてください。
支払方法の記載がない場合は現金としてください。`
              }
            ]
          }]
        })
      });
      const data = await response.json();
      const text = data.content[0].text;
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      setResult(parsed);
      setScreen('confirm');
    } catch (e) {
      alert('読み取りに失敗しました。もう一度撮影してください。');
      setScreen('home');
    } finally {
      setAnalyzing(false);
    }
  };

  // 写真選択・撮影
  const handleCapture = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImage(url);
    setImageFile(file);
    setScreen('analyzing');
    analyzeReceipt(file);
  };

  // Firestoreに保存
  const saveRecord = async () => {
    setSaving(true);
    try {
      await addDoc(collection(db, 'receipts'), {
        ...result,
        createdAt: new Date().toISOString(),
      });
      alert('保存しました！');
      setScreen('home');
      setImage(null);
      setResult(null);
    } catch (e) {
      alert('保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  // Excel出力
  const exportExcel = async () => {
    try {
      const q = query(collection(db, 'receipts'), orderBy('date'));
      const snapshot = await getDocs(q);
      const allRecords = snapshot.docs.map(d => d.data());

      const cash = allRecords.filter(r => r.payment_method === '現金');
      const other = allRecords.filter(r => r.payment_method !== '現金');

      const toRows = (data) => data.map(r => ({
        日付: r.date,
        '店名・取引先': r.store,
        '金額（税込）': r.amount_with_tax,
        '金額（税抜）': r.amount_without_tax,
        消費税額: r.tax_amount,
        勘定科目: r.account_title,
        支払方法: r.payment_method,
        備考: r.memo,
      }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(cash)), '現金出納帳');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(other)), '事業主借');

      const today = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `receipts_${today}.xlsx`);
    } catch (e) {
      alert('Excel出力に失敗しました。');
    }
  };

  // 結果の編集
  const updateResult = (key, value) => {
    setResult(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div style={styles.container}>
      {/* ホーム画面 */}
      {screen === 'home' && (
        <div style={styles.card}>
          <h1 style={styles.title}>📄 レシート管理</h1>
          <button style={styles.primaryBtn} onClick={() => fileInputRef.current.click()}>
            📷 レシートを撮影する
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleCapture}
            style={{ display: 'none' }}
          />
          <button style={styles.secondaryBtn} onClick={exportExcel}>
            📊 Excelを出力する
          </button>
        </div>
      )}

      {/* 解析中画面 */}
      {screen === 'analyzing' && (
        <div style={styles.card}>
          <h2 style={styles.title}>解析中...</h2>
          {image && <img src={image} alt="レシート" style={styles.preview} />}
          <p style={styles.subtext}>しばらくお待ちください</p>
        </div>
      )}

      {/* 確認画面 */}
      {screen === 'confirm' && result && (
        <div style={styles.card}>
          <h2 style={styles.title}>📋 読み取り結果</h2>
          {image && <img src={image} alt="レシート" style={styles.preview} />}

          <div style={styles.field}>
            <label style={styles.label}>日付</label>
            <input style={styles.input} value={result.date || ''} onChange={e => updateResult('date', e.target.value)} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>店名・取引先</label>
            <input style={styles.input} value={result.store || ''} onChange={e => updateResult('store', e.target.value)} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>金額（税込）</label>
            <input style={styles.input} type="number" value={result.amount_with_tax || 0} onChange={e => updateResult('amount_with_tax', Number(e.target.value))} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>金額（税抜）</label>
            <input style={styles.input} type="number" value={result.amount_without_tax || 0} onChange={e => updateResult('amount_without_tax', Number(e.target.value))} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>消費税額</label>
            <input style={styles.input} type="number" value={result.tax_amount || 0} onChange={e => updateResult('tax_amount', Number(e.target.value))} />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>支払方法</label>
            <select style={styles.input} value={result.payment_method || '現金'} onChange={e => updateResult('payment_method', e.target.value)}>
              <option>現金</option>
              <option>PayPay</option>
              <option>クレジットカード</option>
            </select>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>勘定科目</label>
            <select style={styles.input} value={result.account_title || ''} onChange={e => updateResult('account_title', e.target.value)}>
              <option>食料品費</option>
              <option>消耗品費</option>
              <option>交際費</option>
              <option>水道光熱費</option>
              <option>通信費</option>
              <option>その他</option>
            </select>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>備考</label>
            <input style={styles.input} value={result.memo || ''} onChange={e => updateResult('memo', e.target.value)} />
          </div>

          <button style={styles.primaryBtn} onClick={saveRecord} disabled={saving}>
            {saving ? '保存中...' : '✅ 保存する'}
          </button>
          <button style={styles.dangerBtn} onClick={() => { setScreen('home'); setImage(null); setResult(null); }}>
            🗑️ 破棄して撮り直す
          </button>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    display: 'flex',
    justifyContent: 'center',
    padding: '20px',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    padding: '24px',
    width: '100%',
    maxWidth: '480px',
    height: 'fit-content',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  title: {
    textAlign: 'center',
    marginBottom: '24px',
    fontSize: '22px',
  },
  primaryBtn: {
    width: '100%',
    padding: '14px',
    backgroundColor: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    cursor: 'pointer',
    marginBottom: '12px',
  },
  secondaryBtn: {
    width: '100%',
    padding: '14px',
    backgroundColor: '#16a34a',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    cursor: 'pointer',
    marginBottom: '12px',
  },
  dangerBtn: {
    width: '100%',
    padding: '14px',
    backgroundColor: '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    cursor: 'pointer',
    marginBottom: '12px',
  },
  preview: {
    width: '100%',
    borderRadius: '8px',
    marginBottom: '16px',
    maxHeight: '200px',
    objectFit: 'contain',
  },
  field: {
    marginBottom: '12px',
  },
  label: {
    display: 'block',
    fontSize: '13px',
    color: '#666',
    marginBottom: '4px',
  },
  input: {
    width: '100%',
    padding: '10px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '15px',
    boxSizing: 'border-box',
  },
  subtext: {
    textAlign: 'center',
    color: '#666',
  },
};
