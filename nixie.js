/** HEADER
 * FILE:	nixie.js
 *
 * USAGE:	sudo node nixie.js
 *
 * DESCRIPTION:	Nixie Clock, see below for detail.
 *		
 *
 * AUTHOR: 	Mark Wrigley
 * VERSION: 	0.00
 * CREATED: 	28.04.2015
 * REVISION: 	13.09.2015
 *
 * CONFIG:	
 * 		
 *
 */
/** DESCRIPTION
 *
 * OVERVIEW
 * An RPi-controlled nixie clock.
 * GPIO ---> shift register/latch ---> nixie drivers ---> nixie tubes
 * RPi connects via wifi for time synch.
 * RPi serves a web page to allow user to configure the clock.
 * RPi monitors IP address and updates DynDNS (to allow incoming connections).
 * Requires configuration in wifi router to provide static IP, also requires
 * port mapping for incoming connection towards the RPi.
 * 
 * Also requires the following utilities to be scheduled:
 * every 15 mins: check internet connection & bring down/up wifi if necessary
 * every 15 mins: monitor IP address & update DynDNS etc
 * every week: mail log files off
 *
 * DETAILS
 *
 *
 * NOTES
 *
 * https://github.com/fivdi/onoff/blob/master/README.md#usage
 * onoff
*/
/** TO DO
 * TODO: ([x]-completed [.]-incomplete)
 * [x] modify config file when user changes a parameter
 * [x] add pin definitions for nixie drivers/latches/LEDs/buttons etc
 * [x] write routines to output a value to the nixies
 * [x] write routines to animate nixies when they change value
 * [x] write code to control a display blanking pin
 * [.] add hardware button & code to turn clock on during an off period (turn on for a few seconds)
 * [.] code to allow button double-click to toggle clock on/off 
 * [.] rotary encoder (or pushbuttons?) to adjust brightness level (PWM)
 * [.] PWM brightness control
 * [.] regularly get public IP address & send to eMail/SMS/pushover/? notification
 * [.] LDR sensor for auto dimming
 * [.] draw up schematics
 * [.] web crawler to gather various information & data and use this
 *     to modify the behaviour of the clock in some way ... some ideas: 
 *	- LEDs that indicate the position of the sun (e.g. yellow = rising/setting, green=up, red=transit)
 *	- LEDs to indicate moon position/phase
 *	- or servos to indicate these positions?
 * [.] motion sensor to modify clock behaviour (need to think about what can be done here)
 * [.] temperature/humidity sense  & display
 * [.] 2x16 LCD with random quotes / news feed / ...
 * [.] what to do about unreliable counting from the QE? ... it jumps in steps of 4 most of the time but not always ...
 * [.] add tricolor LEDs (at base of nixies)
 * [.] check a calendar to determine what pattern to send to the tricolor LEDs
 *     e.g. different colours/patterns for birthdays, xmas, 1st of the month, ...
 * [.] if I use GPIO15 to drive an LED, it flashes instead of being constant? why?
 */
/** RPi header allocations
 *
 *
 * PIN	  NAME		NAME	  PIN	ALLOCATIONS
 * 1	  3v3		5v0	  2	x	x
 * 3	U GPIO02	5v0	  4	QEpb	x
 * 5	U GPIO03	gnd	  6	-	x
 * 7	U GPIO04	GPIO14	D 8	-	LED2r
 * 9	  gnd		GPIO15	D 10	x	(LED2g)<-- fails ?WHY
 * 11	D GPIO17	GPIO18	D 12	x	ADC_clock
 * 13	D GPIO27	gnd	  14	x	x
 * 15	D GPIO22	GPIO23	D 16	-   	adcOut
 * 17	  3v3		GPIO24	D 18	x	adcIn
 * 19	D GPIO10	gnd	  20	LED1r	x
 * 21	D GPIO09	GPIO25	D 22	LED1g	ADC_cs
 * 23	D GPIO11	GPIO08	D 24	LED1b	LED2b
 * 25	  gnd		GPIO07	D 26	x	LED2g
 * 27	  ID_SD		ID_SC	- 28	x	x		<-- for EEPROM id on expansion board
 * 29	U GPIO05	gnd	  30	QEA  	x
 * 31	U GPIO06	GPIO12	D 32	QEB  	-
 * 33	D GPIO13	gnd	  34	DS   	x
 * 35	D GPIO19	GPIO16	U 36	STCP 	input1
 * 37	D GPIO26	GPIO20	D 38	SHCP	blanking
 * 39	  gnd		GPIO21	D 40	x	-
 *
 * U = pullup resistor default, D = pulldown resistor default
 *
 *
 *
 *
 */
 
/** CIRCUIT
 *
 *
 *
 *
 *
 *
 */ 

const Port = 2002;  	
const DelayNixieRoll = 100;	// milliseconds between digit change when rolling nixies

var app = require('http').createServer(handler);
var io = require('socket.io')(app);
var fs = require('fs');
var Gpio = require('onoff').Gpio;
var lineReader = require('line-reader');

var nixieValue={};				// values of each nixie
var colonUpper = false;				// false=off, true=on
var colonLower = false;
var LED1r = false;					// false = colour off, true = colour on
var LED1g = false;
var LED1b = false;
var LED2r = false;
var LED2g = false;
var LED2b = false;
var clockOn  = '05:59';				// default values, these are overwritten
var clockOff = '23:01';				// when the config file is read
var nixiesOn = false;
var QEprev = 3;					// quadrature encoder value (00, 01, 11, 10) start at 11 (both inputs pulled high)
var QEval1 = 0;					// quadrature encoder variable value
var QEval2 = 0;
var its=0;

var LED1 = 'CC';				// CC/CA common cathode/anode
var LED2 = 'CA';
var Off =    [0,0,0];
var Blue =   [0,0,1];
var Green =  [0,1,0];
var Cyan =   [0,1,1];
var Red =    [1,0,0];
var Purple = [1,0,1];
var Yellow = [1,1,0];
var White =  [1,1,1];
var ledArray = [Off, Blue, Green, Cyan, Red, Purple, Yellow, White];
var nextColour = 0;

var importantDates = [];			// start with empty array

var scheduler = function(timeout, callbackfunction) {
// return a function that calls callbackfunction after a timeout
  return function() {
    setTimeout(callbackfunction, timeout)
  }
};

/**
 * GPIO pin assignment
 * see OnOff GPIO library 
 * https://github.com/fivdi/onoff/blob/master/README.md#usage
 */
 
clock = new Gpio(18, 'out');			// ADC MCP3008
adcOut = new Gpio(23, 'in');
adcIn = new Gpio(24, 'out');
cs = new Gpio(25, 'out');
pinDS = new Gpio(13, 'out');			// external shift register
pinSTCP = new Gpio(19, 'out');
pinSHCP = new Gpio(26, 'out');
pinInput1 = new Gpio(16, 'in', 'rising');	// turn on briefly
//pinBlanking = new Gpio(20, 'out','both');	// display blanking <-- ERROR: cannot trigger on output
pinBlanking = new Gpio(20, 'out');		// display blanking
pinQePushButton = new Gpio(2, 'in', 'both');	// Quadrature Encoder - pushbutton
pinQeEncoderA = new Gpio(5, 'in', 'both');	// - encoder bit A
pinQeEncoderB = new Gpio(6, 'in', 'both');	// - encoder bit B
pinLED1r = new Gpio(10,'out');
pinLED1g = new Gpio(9,'out');
pinLED1b = new Gpio(11,'out');
pinLED2r = new Gpio(14,'out');
pinLED2g = new Gpio(7,'out');
pinLED2b = new Gpio(8,'out');



pinBlanking.writeSync(0);			// blank display at startup
pinInput1.watch(Input1Changed);			// 
//pinBlanking.watch(BlankingChanged);		// see above, trigger not allowed on an output

pinQeEncoderA.watch(QEX);			// either encoder pin triggers
pinQeEncoderB.watch(QEX);			// the same interrupt handler
pinQePushButton.watch(QEB);

/*
 * FUNCTIONS
 */
function handler (req, res) {
  fs.readFile('/home/pi/nodeApps/nixieClock/index.html',
  function (err, data) {
    if (err) {
      res.writeHead(500);
      return res.end('Error loading index.html');
    }
    res.writeHead(200); // 3-digit HTTP status code
    res.end(data);      // the web page
  });
}
function turnClockOnorOff() {
  // called from: bootSequence, 1s interval timer 
  // compare current time with the clock on/off times
  // turn clock (display) on or off as necessary
  var nixieTime = nixieValue[3]+''+nixieValue[2]+':'+nixieValue[1]+''+nixieValue[0]+'';
  console.log(nixieTime+' = '+clockOn+' or '+clockOff+' ?');
  if (nixieTime == clockOn)  {
    console.log('yes, turning ON');
    nixiesOn = true
    pinBlanking.writeSync(1);
  }
  if (nixieTime == clockOff) {
    console.log('yes, turning OFF');
    nixiesOn = false
    pinBlanking.writeSync(0);
  }
  if (nixieTime != clockOn && nixieTime != clockOff) {
    console.log('nope');
  }
}
function sendOneBitToShiftRegister(a) {
  // called from: sendOneDigitToShiftRegister
  // send bit to the shift register & clock it in
  pinDS.writeSync(a);
  pinSHCP.writeSync(1);
  pinSHCP.writeSync(0);
}
function invert(a){
  // change 0 to 1 and vice versa
  var b = 0;
  if (a == 1) {
  } else {
    b = 1;
  }
  return b;
}
function sendColon() {
  if (colonUpper) {
    // send colour to LED1
    if (LED1 == 'CC') {
      pinLED1r.writeSync(LED1r);
      pinLED1g.writeSync(LED1g);
      pinLED1b.writeSync(LED1b);
    } else {
      pinLED1r.writeSync(invert(LED1r));
      pinLED1g.writeSync(invert(LED1g));
      pinLED1b.writeSync(invert(LED1b));
    }
  } else {
    // inhibit LED1
    if (LED1 == 'CC') {
      pinLED1r.writeSync(0);
      pinLED1g.writeSync(0);
      pinLED1b.writeSync(0);
    } else {
      pinLED1r.writeSync(1);
      pinLED1g.writeSync(1);
      pinLED1b.writeSync(1);
    }
    
  }
  if (colonLower) {
    // send colour to LED2
    if (LED2 == 'CC') {
      pinLED2r.writeSync(LED2r);
      pinLED2g.writeSync(LED2g);
      pinLED2b.writeSync(LED2b);
    } else {
      pinLED2r.writeSync(invert(LED2r));
      pinLED2g.writeSync(invert(LED2g));
      pinLED2b.writeSync(invert(LED2b));
    }
  } else {
    // inhibit LED2
    if (LED2 == 'CC') {
      pinLED2r.writeSync(0);
      pinLED2g.writeSync(0);
      pinLED2b.writeSync(0);
    } else {
      pinLED2r.writeSync(1);
      pinLED2g.writeSync(1);
      pinLED2b.writeSync(1);
    }
  }
}
function setColourLed(led,colour){
  if (led == 1) {
    LED1r = colour[0];
    LED1g = colour[1];
    LED1b = colour[2];
  }
  if (led == 2) {
    LED2r = colour[0];
    LED2g = colour[1];
    LED2b = colour[2];
  }
}
function toggleColon() {
  // called from: 100ms and 500ms interval timers
  // invert the state variables associated with the colon dots
  // and call sendColon to write them out to the LEDs
  colonUpper = !colonUpper;
  colonLower = !colonLower;
}
function altColon() {
  colonUpper = true;
  colonUpper = false;
}
function setColon() {
  colonUpper = true;
  colonLower = true;
}
function clearColon() {
  // called from: nobody
  // clear both colon dots
  colonUpper = false;
  colonLower = false;
}
function latchShiftRegister() {
  // called from: sendAllDigitsToShiftRegister()
  // latch the shift register contents to the store register
  pinSTCP.writeSync(1);
  pinSTCP.writeSync(0);
}
function sendOneDigitToShiftRegister(a) {
  // called from: sendAllDigitsToShiftRegister
  // convert the passed value to binary and send
  // the bits out to the shift register
  a = a%16;				// only interested in the 4 LSBs
  var bit = {};
  for (var i=0;i<=3;i++) {bit[i]=0;}	// clear all bits
  var j=1;
  for (i=3;i>=0;i--){			// convert to binary
    j = Math.pow(2,i);
    if (a>=j) {bit[i]=1; a-=j;}
  }
  // send the 4 bits out
  for (i=0;i<=3;i++) {
    sendOneBitToShiftRegister(bit[i])
  }
}
function sendAllDigitsToShiftRegister() {
  // called from: rollNixies(), 1000mS interval timer
  // send all nixie values out to the nixies
  for (var k=0;k<=3;k++) {
    sendOneDigitToShiftRegister(nixieValue[k]);
  }
  latchShiftRegister();
}  
function rollNixies(d,c,b,a) {
  // called from: 1000mS interval timer
  // a non-blocking procedure to update the nixie digits to the target
  // values using a neat animated 'rolling'
  var target={};
  target[0]=a;
  target[1]=b;
  target[2]=c;
  target[3]=d;
  var q=1;
  var schedule = scheduler(DelayNixieRoll, function doStuff() {
    for (p=0;p<=3;p++) {
      if (q<=10) {
        if (nixieValue[p]==(q-1)) {nixieValue[p]=q%10}
      }
      if (q>10) {
        var r=q-10;
        if ((nixieValue[p]<r) && (nixieValue[p] != target[p])) {
          nixieValue[p]++;
        }
      }
    }
    //console.log('q='+q+':  '+nixieValue[3]+','+nixieValue[2]+','+nixieValue[1]+','+nixieValue[0]);  // for testing
    sendAllDigitsToShiftRegister();
    q++;
    if (q<=20) {
      schedule();
    }
  });
  schedule();
}
function padWithZeros(num, size) {
  // called from: interval timers, webserver
  // add '0' prefix(es) to a number
  var s = num+"";
  while (s.length < size) s = "0" + s;
  return s;
}
function isTodaySpecial() {
  // check if today is in the list of special days
  var t_its=0;
  var d = new Date();
  var td = d.getDate();
  var tm = d.getMonth()+1;
  lineReader.eachLine('config.txt', function(line, last) {
    if ((line[0]==';') || (line.length == 1)) {
      // ignore this line
    } else {
        if (line.indexOf('DATE') == 0) {
          var i = line.indexOf('=')+1;
          var l = line.substring(i,line.length).trim();
          var res = l.split(",");
          if ((res[0] == td) && (res[1] == tm)) {
            t_its = res[2];
          }
        }
    }
    if(last){
      its = t_its;
      return false;
    }
  });
}
function readConfigFile() {
  // called from: bootSequence()
  // get today's date
  var d = new Date();
  var td = d.getDate();
  var tm = d.getMonth()+1;
  console.log("today is "+td+"/"+tm);
  nixieValue[2] = d.getHours() % 10;
  nixieValue[1] =  Math.floor(d.getMinutes()/10);
  nixieValue[0] = d.getMinutes() % 10;
    
  // get config info from local config file
 
  lineReader.eachLine('config.txt', function(line, last) {
    if ((line[0]==';') || (line.length == 1)) {
      // ignore this line
    } else {
        if (line.indexOf('ON') == 0) {
          //ON = hh:mm
          var i = line.indexOf('=')+1;
          var l = line.substring(i,line.length).trim();
          clockOn = l;
          console.log('on time is: '+clockOn);
        }
        if (line.indexOf('OFF') == 0) {
          //OFF = hh:mm
          var i = line.indexOf('=')+1;
          var l = line.substring(i,line.length).trim();
          clockOff = l;
          console.log('off time is: '+clockOff);
        }
        if (line.indexOf('DATE') == 0) {
          //DATE = dd,mm,tt (day,month,type)
          //
          var i = line.indexOf('=')+1;
          var l = line.substring(i,line.length).trim();
          var res = l.split(",");
          console.log(res.length+" items: "+res[0]+"/"+res[1]+" -"+res[2]);
          // add to the array of important dates
          importantDates.push(l);
          //does today match?
          if ((res[0] == td) && (res[1] == tm)) {
            console.log("TODAY MATCHES");
          }
        }
    }
    if(last){
      return false;
    }
  });
}
function setNixiesToCurrentTime() {
  // called from: bootSequence() and 1000mS interval timer
  var d = new Date();
  nixieValue[3] = Math.floor(d.getHours()/10);
  nixieValue[2] = d.getHours() % 10;
  nixieValue[1] =  Math.floor(d.getMinutes()/10);
  nixieValue[0] = d.getMinutes() % 10;
}
function bootSequence() {
  // called from: the main code area
  readConfigFile();
  setNixiesToCurrentTime();
  console.log('time at start is '+nixieValue[3]+'.'+nixieValue[2]+'.'+nixieValue[1]+'.'+nixieValue[0]);
  turnClockOnorOff(); 
  app.listen(Port);  
}
function updateCfgFile(par,val) {
  // called from: the web server
  // update the cfg file in response to user(s) changing parameters
  fs.writeFileSync('tempcfg.txt','');				// rename this later
  lineReader.eachLine('config.txt', function(line, last) {
    if ((line[0]==';') || (line.length == 1)) {
      fs.appendFileSync('tempcfg.txt',line+"\n");		// direct copy comment and blank lines
    } else {
      if (line.indexOf(par) > -1) {				// write a new value if the line 
        fs.appendFileSync('tempcfg.txt',par+" = "+val+"\n");	// contains par(ameter)
      } else {
        fs.appendFileSync('tempcfg.txt',line+"\n");		// otherwise directly copy the line
      }
    }
    if (last) {							// no more lines, so ...
      fs.unlinkSync('config.txt');				// delete the source file
      fs.renameSync('tempcfg.txt','config.txt');		// & rename the new file
    }
  });
}
function QEB(err,state) {
  // testing only ... reset the QEval1 counter when button is pushed
  var PB = pinQePushButton.readSync();
  if (PB==0) {
    console.log('PB='+PB);
    QEval1 = 0;
  }
  if (PB==1) {
    console.log('PB='+PB);
  }
}
function QEX(err,state) {
  // called from: interrupt generated on quadrature encoder bit A or B
  // increasing (+): 00 01 11 10 00 ... 1,13,32,20,
  // decreasing (-): 00 10 11 01 00 ... 2,23,31,10,
  var MSB = pinQeEncoderA.readSync();
  var LSB = pinQeEncoderB.readSync();
  //console.log('MSB='+MSB+'  LSB='+LSB);
  var QEnow = MSB*2+LSB;		// 0,1,2,3
  //console.log('QEprev='+QEprev);
  //console.log('QEnow='+QEnow);
  var QEsum = QEprev*10+QEnow;	// 0,1,2,3, 10,11,12,13, 20,21,22,23, 30,31,32,33
  //console.log('QEsum='+QEsum);
  switch (QEsum) {
        case 1:
        case 13:
        case 32:
        case 20:
          QEval1 += 1;
          break;
        case 2:
        case 23:
        case 31:
        case 10:
          QEval1 -= 1;
          break;
          //TODO: limit QEval to min & max of range e.g. 0..100
  }
  QEprev = QEnow;
  //process.stdout.write('QE value = '+QEval);
  if (QEval1 < 0) {
   QEval1 = 0;
  }
  if (QEval1 > 400) {
    QEval1 = 400;
  }
  QEval2 = Math.floor(QEval1/4);
  
  console.log(QEval1+" ---> "+QEval2);
}
function Input1Changed(err,state) {
  // called from: interrupt generated by pinInput1
  // this signals a user request to turn the clock on
  
}
function BlankingChanged(err,state) {
  // called from: interrupt generated by pinBlanking
  // not sure why I put this in ... delete it if I can't think of a reason for it
  console.log('blanking output = '+state);
}
function readAdc(adc_pin, clockpin, adcIn, adcOut, cspin) {
  // called from: 1000mS interval timer
  // TODO: monitor ambient light levels & any other analog inputs
  cspin.writeSync(1);
  clockpin.writeSync(0);
  cspin.writeSync(0);
  command_out = adc_pin;
  command_out |= 0x18;
  command_out <<= 3;
  for (var i = 0; i <= 4; i++) { 
    if ((command_out & 0x80) > 0) {
      adcIn.writeSync(1);
    } else {
      adcIn.writeSync(0);
    }
    command_out <<= 1;
    clockpin.writeSync(1);
    clockpin.writeSync(0);
  }

  clockpin.writeSync(1);		
  clockpin.writeSync(0);	
  result = 0;
  for (i = 0; i <= 9; i++) {
    clockpin.writeSync(1);		
    clockpin.writeSync(0);	
    result <<= 1;
    if (adcOut.readSync() == 1) {
      result |= 0x1;
    }
  }
  cspin.writeSync(1);		
  return result;
};
function exit(){
  // clean up all of the pin assignments
  clock.unexport();
  adcOut.unexport();
  adcIn.unexport();
  cs.unexport();
  pinDS.unexport();
  pinSTCP.unexport();
  pinSHCP.unexport();
  pinInput1.unexport();
  pinBlanking.unexport();
  pinQePushButton.unexport();
  pinQeEncoderA.unexport();
  pinQeEncoderB.unexport();
  pinLED1r.unexport();
  pinLED1g.unexport();
  pinLED1b.unexport();
  pinLED2r.unexport();
  pinLED2g.unexport();
  pinLED2b.unexport();
  console.log();
  console.log ('bye bye');
  process.exit();
}
function randomIntInc (low, high) {
  // generates random integer between two numbers low (inclusive) and high (inclusive) ([low, high])
  return Math.floor(Math.random() * (high - low + 1) + low);
}

setInterval(function(){
  var data,i = 0;
  // send ADC values to clients
  for (i = 0; i <= 7; i++) {
        data = readAdc(i, clock, adcIn, adcOut, cs);
        io.sockets.emit('an'+i,data);    
  }
  var d = new Date();
  var ss = padWithZeros(d.getSeconds(),2); 
  var mm = padWithZeros(d.getMinutes(),2);
  var hh = padWithZeros(d.getHours(),2);
  
  isTodaySpecial();
  if (its == 0) {
    //console.log("meh");
  } else {
    //console.log("today is special: "+its);
  }
  
  if (ss == 0) {
    // on the minute, every minute ...
    
    // send time update to any clients
    var hh = padWithZeros(d.getHours(),2);
    var mm = padWithZeros(d.getMinutes(),2);
    var tt = hh+":"+mm;
    io.sockets.emit('currentTime',tt);
    
    // update the nixie display
    setNixiesToCurrentTime();
    console.log('time is '+tt);
    sendAllDigitsToShiftRegister();
    turnClockOnorOff();
  }
  
  // three times a minute, roll the display to show date/month ...
  if ((ss == 5) || (ss == 25) || (ss == 45))  {
    var d10 = Math.floor(d.getDate()/10);    
    var d1 = d.getDate() % 10;
    var m10 = Math.floor((d.getMonth()+1)/10);    
    var m1 = (d.getMonth()+1) % 10;
    rollNixies(d10,d1,m10,m1);
  }

  // ... then roll to show the year ...
  if ((ss == 10) || (ss == 30) || (ss == 50))  {
    var fullYear = d.getFullYear();
    var y1000 = Math.floor(fullYear/1000);
    fullYear -= y1000*1000;
    var y100  = Math.floor(fullYear/100);    
    fullYear -= y100*100;
    var y10   = Math.floor(fullYear/10);    
    fullYear -= y10*10;
    var y1    = fullYear;
    rollNixies(y1000,y100,y10,y1);
  }

  // ... and finally roll back to the current time
  if ((ss == 15) || (ss == 35) || (ss == 55)) {
    var h10 = Math.floor(d.getHours()/10);
    var h1 = d.getHours() % 10;
    var m10 =  Math.floor(d.getMinutes()/10);
    var m1 = d.getMinutes() % 10;
    rollNixies(h10,h1,m10,m1);
  }
},1000);
setInterval(function(){
  var d = new Date();
  var mm = padWithZeros(d.getMinutes(),2);
  var hh = padWithZeros(d.getHours(),2);
  var ss = d.getSeconds(); 
  var ss2 = padWithZeros(d.getSeconds(),2);
  var ms = d.getMilliseconds();  	// 0..999
  tick = Math.floor(ms/100);		// 0,1,2,...,9
  // tick provides 0.1s markers for output manipulation
  //console.log('tick '+tick);
  var timeRef = 10*ss+tick;		// 0,1,...,597,598,599

  // choose LED colour based on seconds
  nextColour = 1+Math.floor(ss/15);
  setColourLed(1,ledArray[nextColour]);
  setColourLed(2,ledArray[nextColour]);
  
  if (tick==0) {
    // this is the top of the second
    process.stdout.write(' current time is '+hh+':'+mm+':'+ss2+'\r');
    //console.log(' current time is '+hh+':'+mm+':'+ss2);
  }
  
  // toggle colons on/off every 1/2 second for 0 < s < 55
  if (timeRef<550) {
    if (tick == 0) {
      colonUpper = true;
      colonLower = true;
      sendColon();
    }
    if (tick == 5) {
      colonUpper = false;
      colonLower = false;
      sendColon();
    }
  /*
    switch (tick) {
      // toggle the colons on/off every 500ms
      case 0:
      case 5:
        toggleColon();
        sendColon();
        break;
    }
  */
  }
  
  // go to alternating colons at s = 55.0
  if (timeRef == 550) {
    colonUpper = true;
    colonLower = false;
    //altColon();
    sendColon();
  }
  // restore synced colons at s = 0.0
  if (timeRef == 0) {
    //setColon();
    colonUpper = true;
    colonLower = true;
    sendColon();
  }
  // toggle colons 4 times a second for 55 < s < 58
  if ((timeRef > 550) && (timeRef<580)) {
    switch (tick) {
      case 0:
      case 2:
      case 4:
      case 6:
      case 8:
        toggleColon();
        sendColon();
        break;
    }    
  }
  // toggle colons 10 times a second for 58 < s 
  if (timeRef >= 580) {
  /*
    switch (tick) {
      case 0:
      case 1:
      case 2:
      case 3:
      case 4:
      case 5:
      case 6:
      case 7:
      case 8:
      case 9:
        toggleColon();
        sendColon();
        break;
    }    
  */
  toggleColon();
  sendColon();
  }  
},100);
io.on('connection', function (socket) {
    var socketId   = socket.id;
    var clientIp   = socket.request.connection.remoteAddress;
    var clientPort = socket.request.connection.remotePort;
    var d  = new Date();
    var hh = padWithZeros(d.getHours(),2);
    var mm = padWithZeros(d.getMinutes(),2);
    var tt = hh+":"+mm;
    
    // send client address
    socket.emit('ipaddr',clientIp);
    socket.emit('ipport',clientPort);

    // send time information
    var t1 = clockOn;
    var t2 = clockOff;
    //console.log('client connected');
    socket.emit('currentTime',tt);
    socket.emit('onTime',t1);
    socket.emit('offTime',t2);
    for (var i=0; i < importantDates.length; i++) {
      socket.emit('keyDates',i,importantDates[i]);
    }
   /**
    * listen for messages from client
    */
    
    // if client changes clock ON/OFF times:
    socket.on('clockOnOff', function(onOrOff, value) {
      // onOrOff indicates whether the ON time or OFF time is affected
      // value contains the new time
      switch (onOrOff) {
        case 'on':
          clockOn = value;
          io.sockets.emit('onTime',value);
          // update the cfg file
          updateCfgFile('ON',value);
          break;
        case 'off':
          clockOff = value;
          io.sockets.emit('offTime',value);
          // update the cfg file
          updateCfgFile('OFF',value);
          break;
      }
    });
    
});
process.on('SIGINT',exit);

// START HERE!
bootSequence();
