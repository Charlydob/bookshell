'use strict';
// Administrative bootstrap over the existing private SSH connection. Never put this output in public logs.
const{Pool}=require('pg');const{createAuth}=require('./auth');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{const user='b403663c-3675-48fb-a82e-b921d78404b0';const valid=await pool.query('SELECT id FROM users WHERE id=$1 AND disabled=false',[user]);if(!valid.rowCount)throw Error('Owner not available');const ticket=await createAuth(pool).issueTicket(user,'web');console.log(JSON.stringify({url:'https://bookshell.charlydob.com/projects-api/projects/activate?ticket='+ticket,expiresIn:600}));})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
