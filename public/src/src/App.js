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
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRow
