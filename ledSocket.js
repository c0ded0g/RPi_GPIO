/**
 * FILE:	ledSocket.js
 *
 * USAGE:	node ledSocket.js
 *
 * DESCRIPTION:	Access and control RPi GPIO via the web.
 *		Demonstration and testing purposes only.
 *
 * AUTHOR: 	Mark Wrigley
 * CREATED:     15.04.2015
 * REVISIONS:   20.04.2015
 *              28.07.2016 - add controls for remote power
 *
 * CONFIG:	connect LEDs to GPIO 17, 27, 22
 * 		MCP3008 (ADC) connected to GPIO 18, 23 24, 25
 *              74595 (external shift register) connected to GPIO 13,19,26
 *              Bauhn remote controller connected to GPIO 20,21
 *
 * OTHER:       root priveleges are needed for GPIO access, this is avoided
 *              by using gpio-admin tool ... see quick2wire-gpio-admin
 *              - really? maybe not any more - remove this?
 *
 *
 */
 

//--CONST----------------------------------------------------------------------

const Port = 2002;
const RollDelay = 1;

//--REQUIRES-------------------------------------------------------------------

var io = require('socket.io');
var connect = require('connect');
var serveStatic =require('serve-static');
var fs = require('fs');
var Gpio = require('onoff').Gpio;

//--VAR------------------------------------------------------------------------

/**
 * app is the webserver object
 * controlPanel is a socket, listening to messages from app
 */

var app = connect().use(serveStatic('public')).listen(Port);
var controlPanel = io.listen(app);   

/** 
 *  GPIO: power controller
 *  channelPin is an array representing the pins that connect to the AC 
 *  mains controller. Each channel requires two pins (on, off), and the 
 *  index into the array is a function of both the channel number (1-4) 
 *  and the operation (on/off):
 *  index = (chan - 1)*2 + dir, where chan = 1,2,3,4 & dir = 0 (off) or 1 (on)
 */

// arrays representing 7-segment display patterns
// d0..dF represent the segment pattern for each digit 0..F
// dArray provides a means to obtain the desired bit pattern 
// by specifying an index value - e.g. dArray[4] is the bit
// pattern that will cause a 7-seg display to indicate '4'

//         
//        ---a---
//       |      |
//      f      b
//      |      |
//      ---g---
//     |      |
//     e      c
//    |      |
//    ---d---
//             .dp
//

//        b  a  f  g  dp c  d  e 
var d0 = [1, 1, 1, 0, 0, 1, 1, 1];
var d1 = [1, 0, 0, 0, 0, 1, 0, 0];
var d2 = [1, 1, 0, 1, 0, 0, 1, 1];
var d3 = [1, 1, 0, 1, 0, 1, 1, 0];
var d4 = [1, 0, 1, 1, 0, 1, 0, 0];
var d5 = [0, 1, 1, 1, 0, 1, 1, 0];
var d6 = [0, 1, 1, 1, 0, 1, 1, 1];
var d7 = [1, 1, 0, 0, 0, 1, 0, 0];
var d8 = [1, 1, 1, 1, 0, 1, 1, 1];
var d9 = [1, 1, 1, 1, 0, 1, 1, 0];
var dA = [1, 1, 1, 1, 0, 1, 0, 1];
var dB = [0, 0, 1, 1, 0, 1, 1, 1];
var dC = [0, 1, 1, 0, 0, 0, 1, 1];
var dD = [1, 0, 0, 1, 0, 1, 1, 1];
var dE = [0, 1, 1, 1, 0, 0, 1, 1];
var dF = [0, 1, 1, 1, 0, 0, 0, 1];
var db = [0, 0, 0, 0, 0, 0, 0, 0];  //blank
var dArray = [d0,d1,d2,d3,d4,d5,d6,d7,d8,d9,dA,dB,dC,dD,dE,dF,db];

/**
 * ARRAYS
 * ledPin	GPIO, LEDs
 * ledState	LED status (on/off)
 * channelPin	GPIO, AC power controller
 * NOTE:
 * These vars are declared here, but initialized in the bootSequence code.
 */
var ledPin={};
var ledState={};
var channelPin={};   

var isDark=0;  // set to 1 if it is dark, 0 if it is not dark

/**
 * NOTE: the index into the channelPin array = (chan - 1)*2 + dir
 * where chan = 1,2,3,4 & dir = 0 (off) or 1 (on)
 * e.g. channel 1 off = 0, channel 1 on = 1
 *      channel 2 off = 2, channel 2 on = 3
 */
 
readAdc = function(adc_pin, clockpin, adc_in, adc_out, cspin) {
/**
 * return a value from the ADC
 * GIVEN PARAMETERS:
 * adc_pin	0..7
 * clockpin	clock GPIO
 * adc_in	adc_in GPIO
 * adc_out	adc_out GPIO
 * cspin	cs GPIO
 * RETURNS:
 * result of the ADC conversion for the given ADC channel
 */
  
  // this uses an SPI serial interface
  
  // toggle CS high then low to initiate comms
  // CS is actually CS-bar (inverted) so chip select is active low
  cspin.writeSync(1);
  clockpin.writeSync(0);
  cspin.writeSync(0);
  
  // create the 5-bit command to send to the ADC
  // S,M,D2,D1,D0 
  // where S=1=start bit, M=1=single-ended input mode, D2/D1/D0 = input channel
  // result is 11xxx000 where xxx = input channel (0-7)
  command_out = adc_pin;
  command_out |= 0x18;
  command_out <<= 3;
  
  /**
   * TIMING:
   *
   * the first 6 clock pulses:
   *        1    2    3    4    5    6 
   * CLK  _/ \__/ \__/ \__/ \__/ \__/ \__/ \__/
   * Din   S    M    D2   D1   D0
   *                           ^^^^^^^^ sample period
   *  the next 11 clock pulses:
   *         6    7    8    9    10   11   12   13   14   15   16   17
   *  CLK  _/ \__/ \__/ \__/ \__/ \__/ \__/ \__/ \__/ \__/ \__/ \__/\__/\_
   *  Dout    null B9   B8   B7   B6   B5   B4   B3   B2   B1   B0
   *
   * NOTES:
   * on rising edge of CLK 5, sampling starts
   * on falling edge of CLK 6, sampling ends
   * on falling edge of CLK 6, null bit is read
   * on falling edges of CLK 7-16 the 10 bits of the conversion can be read
   *
   */
  
  for (i = 0; i <= 4; i++) { 
    // send CLK 1..5
    if ((command_out & 0x80) > 0) {
      adc_in.writeSync(1);
    } else {
      adc_in.writeSync(0);
    }
    command_out <<= 1;
    clockpin.writeSync(1);
    clockpin.writeSync(0);
  }

  // send CLK 6
  // to end the sample period
  // adc_in is "don't care" for this clock
  clockpin.writeSync(1);		
  clockpin.writeSync(0);	
  // null bit is presented on Dout at the falling edge of CLK 6
  
  // read the ADC result from the ADC
  // bits are presented at the falling edge of each CLK
  result = 0;
  for (i = 0; i <= 9; i++) {
    // clock pulses 7..16
    clockpin.writeSync(1);		
    clockpin.writeSync(0);	
    result <<= 1;
    if (adc_out.readSync() == 1) {
      result |= 0x1;
    }
  }
  
  // deselect the chip
  cspin.writeSync(1);		
  return result;
};

/**
 * This stuff does my head in. 
 * scheduler is a function that can be assigned to variable later on
 * it accepts two parameters: timeout and a call back function
 * and returns a function that invokes the call back function after a timeout
 *
 * For usage examples, see functions below: pulseChannel, sendDigits
 * 
 */
var scheduler = function(timeout, callbackfunction) {
  return function() {
    setTimeout(callbackfunction, timeout)
  }
};

pulseChannel = function(chan, dir) {
/**
 * Using the values of chan and dir, work out which GPIO pin
 * needs to be pulsed, and send a short pulse to it.        
 * Also send an update to all clients so that the action can
 * be mimicked on the client screen.
 *
 */
  var schedule0 = scheduler(500, function doStuff0() {
    // in 500mS, write 0 to the GPIO pin, and send a 
    // message to all clients
    channelPin[index].writeSync(0)
    controlPanel.sockets.emit('ch',chan,dir,0);
  });
  var index = (chan - 1)*2 + dir;
  // write 1 to the GPIO pin,
  // send a message to all clients,
  // then call the scheduler to write 0 after a short delay
  channelPin[index].writeSync(1)
  controlPanel.sockets.emit('ch',chan,dir,1);
  schedule0();
}

sendDigits = function(a,b) {
/**
 * send a then b to the shift register ...
 * 1) counter q is initialised to 0
 * 2) schedule1 is set up write to the shift register, increment a counter (q),
 *    and call itself until the counter q exceeds 15
 * 3) schedule 1 is called, entering with q=0
 */ 
  var q=0;
  
  var schedule1 = scheduler(RollDelay, function doStuff1() {
    // on entry, q should be between 0 and 15
    // 0..7 identify bits in a
    // 8..15 identify bits in b
      
    // write one bit to the DS line, depending on the value of q
    // if it is dark (according to the LDR connected to the ADC)
    // light up one of the decimal points
    if (q < 8) {
      if ((q == 4) && (isDark == 1)) {
        // bit 4 controls the decimal point
        pinDS.writeSync(1);
      } else {
        pinDS.writeSync(a[q]);
      }
    } else {
      pinDS.writeSync(b[q-8]);
    }
      
    // toggle the shift register to accept the bit,
    // increment the counter, and call schedule1 if
    // we have not yet reached the end of the digits
    pinSHCP.writeSync(1);
    pinSHCP.writeSync(0);
    q++;
    if (q<=15) {
      // not done yet ... send the next bit
      schedule1();
    } else {
      // done ... toggle the storage register to latch the values to the outputs
      pinSTCP.writeSync(1);
      pinSTCP.writeSync(0);
    }
  });
  schedule1();
}


// return a random integer between min & max (inclusive) 
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

//-----------------------------------------------------------------------------

function bootSequence() {
 /**
  * All actions to be taken at start up are gathered here.
  * This makes it easier to maintain the startup code and makes
  * it easier to control the GPIO assignment and release
  * (in the following exit() code)
  *
  * Could probably move more code into here from above.
  */
  
 /** 
  * assign GPIO pins
  */
   
  // LEDs
  ledPin[0] = new Gpio(17, 'out');
  ledPin[1] = new Gpio(27, 'out');
  ledPin[2] = new Gpio(22, 'out');
  
  // AC mains controller
  channelPin[0] = new Gpio(20, 'out');
  channelPin[1] = new Gpio(21, 'out');

  // ADC
  clock   = new Gpio(18, 'out');  // pin 13
  adc_out = new Gpio(23, 'in');   // pin 12
  adc_in  = new Gpio(24, 'out');  // pin 11
  cs      = new Gpio(25, 'out');  // pin 10

  // shift register
  pinDS = new Gpio(13, 'out');	  // pin 14
  pinSTCP = new Gpio(19, 'out');  // pin 12
  pinSHCP = new Gpio(26, 'out');  // pin 11

 /**
  * initialise the shift register
  */
  
  pinSHCP.writeSync(0);
  pinSTCP.writeSync(0);
  
/**
 * set up the LED pins and associated status var
 */
   
for (i=0; i<=2; i++) {
  ledState[i]=0;
  ledPin[i].writeSync(ledState[i]);
} 
}

//-----------------------------------------------------------------------------

function exit() {

 /**
  * All code that needs to run before the program exits is here.
  * The most important code is the release of the GPIOs.
  */

 /** 
  * clear GPIOs and unexport
  * ensure all GPIOs assigned in bootSequence are unexported
  */

  ledPin[0].unexport();
  ledPin[1].unexport();
  ledPin[2].unexport();

  channelPin[0].unexport();
  channelPin[1].unexport();

  clock.unexport();
  adc_out.unexport();
  adc_in.unexport();
  cs.unexport();

  pinDS.unexport();
  pinSTCP.unexport();
  pinSHCP.unexport();
  
/**
 * parting message
 */
   
  console.log();
  console.log ('bye bye');

/**
 * & exit
 */
 
  process.exit();
}

//-----------------------------------------------------------------------------

setInterval(function(){
/**
 * this stuff gets done once per second
 */

  // temporary code to flash one of the LEDs while testing
  //var j = getRandomInt(0,2);
  //j=2;
  //ledPin[j].writeSync(ledPin[j].readSync() === 0 ? 1 : 0);
  //ledState[j] = ledState[j] === 0 ? 1 : 0;
 
 
  var d = new Date();
//  var n = d.getDate();
//  var y = d.getFullYear();
//  var m = d.getMonth();
//  var hh = d.getHours();
//  var mm = d.getMinutes();
  var ss = d.getSeconds();
  var a = ss%10;		// units
  var b = (ss-a)/10;	// tens
  sendDigits(dArray[a],dArray[b]);
//  console.log(n+"/"+m+"/"+y+"   "+hh+":"+mm+":"+ss);
  
  // update all clients with ADC values
  var data,i = 0;
  for (i = 0; i <= 7; i++) {
        data = readAdc(i, clock, adc_in, adc_out, cs);
        controlPanel.sockets.emit('an'+i,data);   
        // send one of the results to the 7-segment display
        // TO BE COMPLETED - ADD SHIFT REGISTER CONNECTION DETAILS ETC
        if (i==1) {
  		var x= Math.floor(data/10);      			// 34
  		var adc0 = x % 10;					// 4
  		var adc1 = Math.floor((x - adc0)/10);			// (34-4)/10 = 3
  //		sendDigits(dArray[adc0],dArray[adc1]);
        } 
        // turn on an LED if it is dark
        // AN6 high
        if (i==6) {
          if (data > 200) {
            // LED on
            ledPin[2].writeSync(1);
            ledState[2] = 1;
            controlPanel.sockets.emit('ledstatus',2,ledState[2]);
            isDark = 1;
          } else {
            // LED off
            ledPin[2].writeSync(0);
            ledState[2] = 0;
            controlPanel.sockets.emit('ledstatus',2,ledState[2]);
            isDark = 0;
          }
        }
  }
  
},1000);

/**
 *  controlPanel object handles signals from socket
 */

controlPanel.on('connection', function (socket) {
   /**
    * this stuff runs when a new browser connection is made
    */
    var socketId = socket.id;
    var clientIp = socket.request.connection.remoteAddress;
    var clientPort = socket.request.connection.remotePort;
    socket.emit('ipaddr',clientIp);
    socket.emit('ipport',clientPort);

    // update all LED indicators in the new client
    for (i=0; i<=2; i++) {
      socket.emit('ledstatus',i,ledState[i]);
    }
    
   /**
    * set up event handlers for events coming from this client
    * typically these will take some action then send an event
    * back to the client, and all other clients so that they can
    * update accordingly
    */
    
    socket.on('led', function(ledNumber,action) {
    /**
     * expect ledNumber = 0,1,2
     * expect action = 0,1,2 (0=off, 1=on, 2=toggle)
     */
     
      //for testing only
      //console.log("led "+ledNumber+": "+action+".")
      
      switch (action) {
        case 0:
        case 1:
          ledPin[ledNumber].writeSync(action);
          ledState[ledNumber] = action;
          controlPanel.sockets.emit('ledstatus',ledNumber,ledState[ledNumber]);
          break;
        case 2:
          ledState[ledNumber] = ledState[ledNumber] === 0? 1 : 0;
          ledPin[ledNumber].writeSync(ledState[ledNumber]);
          controlPanel.sockets.emit('ledstatus',ledNumber,ledState[ledNumber]);
          break;
      }
      
      // NOTE
      // socket.emit sends only to the one client
      // io.sockets.emit sends to all clients
      
      //for (i=0; i<=2; i++) {
      //  console.log(" "+i+":"+ledState[i]) 
      //}
      
    });
    
    socket.on('ch', function(channel, direction) {
      // expect channel = 1,2,3 or 4
      // expect direction = 1 (on) or 0 (off)
      pulseChannel(channel, direction);
    });
    
});


//---START HERE----------------------------------------------------------------

bootSequence();

//---END HERE -----------------------------------------------------------------

process.on('SIGINT',exit);

//---END OF CODE---------------------------------------------------------------

/**
 *
 * ICs, PINOUTS, etc
 *
 * MCP3008
 *         :-----:    
 *   Ch0  1:*    :16 Vdd (2.7-5.5v) <-- doesn't work @ 5v, only @ 3v3 WHY?
 *   Ch1  2:     :15 Vref
 *   Ch2  3:     :14 Agnd
 *   Ch3  4:     :13 CLK
 *   Ch4  5:     :12 Dout
 *   Ch5  6:     :11 Din
 *   Ch6  7:     :10 ^CS/SHDN
 *   Ch7  8:     : 9 Dgnd
 *         :-----:     
 * 74HC595
 *         :-----:
 *   Q1   1:*    :16 Vcc            Q0..Q7 parallel data out
 *   Q2   2:     :15 Q0             
 *   Q3   3:     :14 DS ----------- serial data input
 *   Q4   4:     :13 ^OE            output enable, active low
 *   Q5   5:     :12 STCP --------- storage register clock input
 *   Q6   6:     :11 SHCP --------- shift register clock input
 *   Q7   7:     :10 ^MR            MR master reset, active low
 *   GND  8:     : 9 Q7'            
 *         :-----:
 
 * 7-SEGMENT DISPLAY
 *
 *     g   f  com  a   b
 *     |   |   |   |   |
 *    ------------------
 *    :     --a--       :
 *    :   f|    |b      :
 *    :    --g--        :
 *    :  e|    |c       :
 *    :   --d--   .P    :
 *    ------------------
 *     |   |   |   |   |
 *     e   d  com  c   P
 *
 *
 *
 */