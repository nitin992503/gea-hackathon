// See https://github.com/dialogflow/dialogflow-fulfillment-nodejs
// for Dialogflow fulfillment library docs, samples, and to report issues
'use strict';
 
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const {WebhookClient} = require('dialogflow-fulfillment');
const {Card, Suggestion} = require('dialogflow-fulfillment');
 
process.env.DEBUG = 'dialogflow:debug'; // enables lib debugging statements
admin.initializeApp(functions.config().firebase);
const db = admin.firestore();

exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
    const agent = new WebhookClient({ request, response });
    console.log('Dialogflow Request headers: ' + JSON.stringify(request.headers));
    console.log('Dialogflow Request body: ' + JSON.stringify(request.body));
 
    function welcome(agent) {
        agent.add(`Welcome to my agent!`);
    }
    
    function fallback(agent) {
        agent.add(`I didn't understand`);
        agent.add(`I'm sorry, can you try again?`);
    }

    function appliance(agent){
        let p = agent.parameters;
        return db.collection("appliance").doc(p["serial-data"]).get()
        .then(doc=>{
            if(doc.exists){
                console.log(doc.data());
                let str = "Is your appliance a "+doc.data().appliance+" with model no. "+doc.data().model; 
                agent.add(str);
                agent.setContext({
                    'name' : 'appliance',
                    'parameters' :{
                        'serial_no' : p['serial-data'],
                        'model_no' : doc.data().model,
                        'appliance' : doc.data().appliance,
                    },
                    'lifespan' : 5
                });
            }
            else{
                console.log('oops');
                agent.add('please renter your appliance serial number');   
            }
        })
        .catch(err=>{
            agent.add('Unable to process your request please try again later');
        });
    }

    function book(agent){
        
        let p = agent.parameters;
        
            // get technicians avilable on particular pin code

        return db.collection('pincode').doc(p.pincode).get()
        .then(doc => {
            if(doc.exists){
                // scheduler 
                let tech = [];
                console.log(doc.data());
                doc.data().tech.forEach(ele=>tech.push(db.doc('technician/'+ele)));
                console.log(tech);
                //push details of techinicians in array
                return db.getAll(...tech);
            }
            else{
                let a = 'services at pincode are not yet avilable';
                console.log(a);
                throw a;
            }
        })
        .then(tec=>{
            console.log(tec);
            let technician = {};
            tec.forEach(ele=>{
                    let a = ele.id;
                    technician[a]=ele.data();
                });
            console.log(technician);
            //schedule appointment
            let schedule = scheduler(technician);
            console.log(schedule);
            let str='';
            for(let i =0 ;i<schedule.length;i++){
                str+=`(slot ${i+1} . )  ${schedule[i].date.toDateString()} ${getslot(schedule[i].slot)}      `;                
            }
            agent.setContext({
                'name' : 'fix',
                'parameters' : {
                    'schedule' : schedule,
                    'address' : p.add,
                    'pincode' : p.pincode,
                    'email' : p.email,
                    'phone_number' : p.phone_number,
                    'problem' : p.problem,
                },
                'lifespan' : 5
            });
            console.log('done');
            agent.add('please select a time slot for your appointment '+str);
        })
        .catch(function(error) {
            console.log(error);
            agent.add("Cannot book service appointment: "+error);
        });

    }

    function fix(agent){
        let p,q,id;
        request.body.queryResult.outputContexts.forEach(ele => {
            if(ele.name == 'projects/gea-xssuiw/agent/sessions/e0170c4e-572c-5073-d91a-92314a9f23a5/contexts/appliance')
            p = ele.parameters;
            else if(ele.name == 'projects/gea-xssuiw/agent/sessions/e0170c4e-572c-5073-d91a-92314a9f23a5/contexts/fix')
            q = ele.parameters.schedule;
        });
        console.log(q);
        let slot =  parseInt(p.slot)-1;
        console.log(q[0]);
        console.log(typeof(slot));
        console.log(q[slot]);
        console.log(parseInt(q[slot].slot));
        let da = new Date(q[slot].date);
        
        return db.collection("users").add({
            email : p.email,
            problem : p.problem,
            address : p.address,
            phone : p.phone_number,
            pincode : p.pincode,
            serial : p.serial_no,
            model : p.model_no,
            appliance : p.appliance,
            time : getslot(parseInt(q[slot].slot)),
            date : da.toDateString(),
            technician : q[slot].technician,
            slot : q[slot].slot,
        })
        .then(usr=>{
            id = usr.id;
            agent.add('Your appointment is booked , your service id is '+usr.id);
            let tech = db.collection('technician');
            return tech.doc(q[slot].technician).get();
        })
        .then(doc=>{
            let p,q;
            request.body.queryResult.outputContexts.forEach(ele => {
                if(ele.name == 'projects/gea-xssuiw/agent/sessions/e0170c4e-572c-5073-d91a-92314a9f23a5/contexts/appliance')
                p = ele.parameters;
                else if(ele.name == 'projects/gea-xssuiw/agent/sessions/e0170c4e-572c-5073-d91a-92314a9f23a5/contexts/fix')
                q = ele.parameters.schedule;
            });
            let slot = parseInt(p.slot)-1;
            let da = new Date( q[slot].date);
            let dat = da.toDateString();
            let tech = db.collection('technician');
            console.log('success');
            let d = doc.data();
            if(d[dat]){
                let s = d[dat]; 
                s[parseInt(q[slot].slot)]=id;
                let obj = {};
                obj[dat] = s;
                return tech.doc(doc.id).update(obj);
            }
            else{
                let s = ['n','n','n'];
                s[q[slot].slot] = id;
                let obj = {};
                obj[dat] = s;
                return tech.doc(doc.id).update(obj);
            }
        })
        .then(doc=>{
            console.log('success');
        })
        .catch(err =>{
            console.log(err);
        });
    }

    function scheduler(technician){
        let date = new Date();
        console.log(date);
        let slot = 0;
        let book = [];
        let schdld = date;
        if(date.getHours() < 9){
            for(let i=0;i<3;i++)
                for(let prop in technician){
                    if(technician[prop].hasOwnProperty(date)){
                        if(technician[prop][date.toDateString()][i] == 'n' && technician[prop][date.toDateString()][i] );   
                        else{
                            book.push({
                                technician : prop,
                                date : date, 
                                slot : i, 
                            });
                            slot+=1;
                            break;
                        }
                    }
                    else{
                        book.push({
                            technician : prop,
                            date : date, 
                            slot : i, 
                        });
                        slot+=1;
                        break;
                    }
                }
        }
        else if(date.getHours() < 12){
            for(let i=1;i<3;i++)
                for(let prop in technician){
                    if(technician[prop].hasOwnProperty(date)){
                        if(technician[prop][date.toDateString()][i] =='n' && technician[prop][date.toDateString()][i] );   
                        else{
                            book.push({
                                technician : prop,
                                date : date, 
                                slot : i, 
                            });
                            slot+=1;
                            break;
                        }
                    }
                    else{
                        book.push({
                            technician : prop,
                            date : date, 
                            slot : i, 
                        });
                        slot+=1;
                        break;
                    }
                }
        
        }
        else if(date.getHours() < 14){
            for(let prop in technician){
                if(technician[prop].hasOwnProperty(date.toDateString())){
                    if(technician[prop][date.toDateString()][2] =='n' && technician[prop][date.toDateString()][2] );   
                    else{
                        book.push({
                            technician : prop,
                            date : date, 
                            slot : 2, 
                        });
                        slot+=1;
                        break;
                    }
                }
                else{
                    book.push({
                        technician : prop,
                        date : date, 
                        slot : 2, 
                    });
                    slot+=1;
                    break;
                }
            }
        
        }
        
        for(let i=0;slot<4;i++){
            schdld = new Date(schdld.valueOf()+24*60*60*1000);
            for(let i=0;i<3;i++){
                for(let prop in technician){
                    if(technician[prop].hasOwnProperty(schdld.toDateString())){
                        if(technician[prop][schdld.toDateString()][i] !=='n' && technician[prop][schdld.toDateString()][i] );   
                        else{
                            book.push({
                                technician : prop,
                                date : schdld, 
                                slot : i, 
                            });
                            slot+=1;
                            break;
                        }
                    }
                    else{
                        book.push({
                            technician : prop,
                            date : schdld, 
                            slot : i, 
                        });
                        slot+=1;
                        break;
                    }
                }
            }
        }

        return book;
    }

    function getslot(i){
        switch(i){
            case 0 : return '10 A.M - 12:30 P.M';
            case 1 : return '1 P.M - 3:30 P.M';
            case 2 : return '4 P.M - 6:30 P.M';
        }
    }
    
    function deleteap(agent){
        let usr = db.collection('users').doc(agent.parameters.id);
        let tec,date,slot,col;
        return usr.get()
        .then(doc=>{
            if(doc.exists){
                slot = doc.data().slot;
                date = doc.data().date;
                tec = doc.data().technician;
                col = db.collection('technician').doc(tec);
                return db.collection('users').doc(agent.parameters.id).delete();
            }
            else{
                let err = 'no appointment with this service id found';
                throw err;
            }
        })
        .then(doc=>{
            agent.add('appointment canceled successfully');
            return col.get();
        })
        .then(doc=>{
            console.log(doc.data);
            let arr = doc.data()[date];
            console.log(typeof(slot));
            console.log(arr);
            arr[slot] = 'n';
            let obj = {};
            obj[date] = arr;
            return col.update(obj);
        })
        .then(doc => {
            console.log('success');
            return 0;
        })
        .catch(err => {
            console.log(err);
            return err;
        });
    }
    
    function reschedule(agent){
        let id = agent.parameters.id;
        let usr,pd,slot;
        return db.collection('users').doc(id).get()
        .then(doc=>{
            usr = doc.data();
            return db.collection('pincode').doc(usr.pincode).get();
        })
        .then(doc => {
            if(doc.exists){
                // scheduler 
                let tech = [];
                doc.data().tech.forEach(ele=>tech.push(db.doc('technician/'+ele)));
                //push details of techinicians in array
                return db.getAll(...tech);
            }
            else{
                let a = 'services at pincode are not yet avilable';
                throw a;
            }
        })
        .then(tec=>{
            let technician = {};
            tec.forEach(ele=>{
                    let a = ele.id;
                    technician[a]=ele.data();
                });
            //schedule appointment
            let schedule = scheduler(technician);
            let str='';
            for(let i =0 ;i<schedule.length;i++){
                str+=` (slot ${i+1}. )  ${schedule[i].date.toDateString()} ${getslot(schedule[i].slot)}  `;                
            }
            agent.setContext({
                'name' : 'fix2',
                'parameters' : {
                    'schedule' : schedule,
                    'id' : id,
                    'prev_date' : usr.date,
                    'prev_slot' : usr.slot,
                },
                'lifespan' : 5
            });
            agent.add('please select a time slot for your appointment '+str);
            return 0;
        })
        .catch(function(error) {
            console.log(error);
            agent.add("Cannot book service appointment: "+error);
        });
    }

    function fix2(agent){
        let p,id;
        request.body.queryResult.outputContexts.forEach(ele => {
            if(ele.name == 'projects/gea-xssuiw/agent/sessions/e0170c4e-572c-5073-d91a-92314a9f23a5/contexts/fix2')
            p = ele.parameters;
        });
        id = p.id;
        let slot =  parseInt(p.slot)-1;
        let da = new Date(p.schedule[slot].date);
        return db.collection("users").doc(p.id).update({
            time : getslot(parseInt(p.schedule[slot].slot)),
            date : da.toDateString(),
            technician : p.schedule[slot].technician,
            slot : parseInt(p.schedule[slot].slot),
        })
        .then(usr=>{
            let tech = db.collection('technician');
            agent.add('Your appointment is successfully updated ');
            return tech.doc(p.schedule[slot].technician).get();
        })
        .then(doc=>{
            let d = doc.data();
            console.log(d);
            let tech = db.collection('technician');
            let obj = {};
            if(da.toDateString() == p.prev_date && d[da.toDateString()]){
                let s = d[da.toDateString()]; 
                s[parseInt(p.schedule[slot].slot)]= id;
                console.log(typeof(p.prev_slot));
                console.log(s);
                s[p.prev_slot] = 'n';
                obj[da.toDateString()] = s;
                console.log(s);
                console.log(obj);
                return tech.doc(doc.id).update(obj);
            }
            else{
                let s1 = ['n','n','n'] , s2;
                s1[p.schedule[slot].slot] = id;
                s2 = d[p.prev_date];
                console.log(typeof(p.prev_slot));
                console.log(s1);
                console.log(s2);
                s2[p.prev_slot]='n';
                obj[da.toDateString()] = s1;
                obj[p.prev_date] = s2;
                console.log(obj);
                return tech.doc(doc.id).update(obj);
            }
        })
        .then(doc=>{
            console.log('success');
        })
        .catch(err =>{
            console.log(err);
        });
    }
    
    function info(){
        return db.collection('users').doc(agent.parameters.id).get()
        .then(usr=>{
            console.log(usr.data());
            let inf = usr.data();
            let date = inf.date;
            let time = inf.time;
            let tec = inf.technician;
            let app = inf.appliance;
            let model = inf.model;
            let serial = inf.serial;
            agent.add(`information :- | date : ${date} , time : ${time} , technicain : ${tec} , appliance : ${app} , model no. ${model} , serial no. : ${serial}`);          
        });
    }
    
    // Run the proper function handler based on the matched Dialogflow intent name
    let intentMap = new Map();
    intentMap.set('cancel - appointment - custom' , deleteap);
    intentMap.set('book appointment - custom',appliance);
    intentMap.set('book appointment - custom - yes - custom',book);
    intentMap.set('book appointment - custom - yes - custom - custom',fix);
    intentMap.set('Default Welcome Intent', welcome);
    intentMap.set('Default Fallback Intent', fallback);
    intentMap.set('reschedule - custom', reschedule);
    intentMap.set('reschedule - custom - custom',fix2);
    intentMap.set('info - custom',info);
    agent.handleRequest(intentMap);
});
