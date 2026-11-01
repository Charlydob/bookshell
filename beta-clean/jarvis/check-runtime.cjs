'use strict';
// Run inside the deployed API container before accepting a release.
for(const file of ['./finance','./nutrition','./gym'])require(file);
const {schemas}=require('./module-contracts');
for(const name of ['finance_create','nutrition_product_create','nutrition_product_update','nutrition_entry_create'])if(!schemas[name])throw new Error('Missing MCP contract: '+name);
console.log('Finance, nutrition and gym runtime dependencies and repair contracts loaded.');
