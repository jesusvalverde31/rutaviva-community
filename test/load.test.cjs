'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {scoreContribution}=require('../src/services/contribution-score.cjs');
test('cálculo acotado soporta mil aportaciones sin estado compartido',async()=>{const results=await Promise.all(Array.from({length:1000},(_,index)=>Promise.resolve(scoreContribution({confirmations:index%8,rejections:index%3,ageDays:index%90}))));assert.equal(results.length,1000);assert.equal(results.every(item=>Number.isInteger(item.score)&&item.score>=0&&item.score<=100),true);});
