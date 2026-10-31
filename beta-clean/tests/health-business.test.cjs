'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('native browser and backend load the same gym snapshot/total service',()=>{
 const sandbox={structuredClone};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../scripts/shared/services/gym-business.js'),'utf8'),sandbox);
 const ctx=sandbox.BookshellGym.context({bench:{name:'Bench',type:'reps',muscleGroups:['Chest']}},{}),e=ctx.snapshot('bench',[{reps:8,kg:60,done:true}]);
 assert.equal(e.nameSnapshot,'Bench');assert.equal(ctx.totals({exercises:{bench:e}}).totalVolumeKg,480);
});
test('nutrition conversions require known unit weight and preserve missing nutrients during native serialization',()=>{
 const b=require('../scripts/shared/services/nutrition-business');assert.equal(b.convertAmountWithProduct({unitWeightQty:60,unitWeightUnit:'g'},2,'unit','g'),120);assert.equal(b.convertAmountWithProduct({},2,'unit','g'),null);assert.equal(b.convertAmountWithProduct({},100,'ml','g'),null);
 const snapshot=b.preserveEntryMacros({macrosSnapshot:{kcal:4,protein:0,carbs:0,fat:0},missingMacros:['protein','carbs','fat']});assert.equal(snapshot.protein,null);assert.equal(snapshot.kcal,4);
});
test('native recipe consumption scales total nutrition by yield and never mutates recipe snapshots',()=>{
 const b=require('../scripts/shared/services/nutrition-business'),recipe={id:'qa',title:'QA',servings:2,nutritionTotals:{kcal:590,protein:55,carbs:78,fat:5},ingredients:[{qty:100,unit:'g'}]};
 const entry=b.recipeEntry(recipe,2,'dinner',{id:'entry',now:1,computedCost:null,sideEffects:{habits:[]}});assert.equal(entry.macrosSnapshot.kcal,590);entry.recipeSnapshot.ingredients[0].qty=20;assert.equal(recipe.ingredients[0].qty,100);
});
