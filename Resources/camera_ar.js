/*****************************************************************************/
/* Copyright (c) 2010-2011 Olivier Morandi                                   */
/* please read file LICENSE in the Titanium-AR root folder.                  */
/*                                                                           */
/*****************************************************************************/

var win = Titanium.UI.currentWindow;
win.backgroundColor = 'black';

Ti.Geolocation.purpose = 'calculating your actual position and orientation';


// math helpers
function toRad(x)
{
    return x * Math.PI/180;
}

function toDeg(x)
{
    return ((x * 180/ Math.PI) + 360) % 360;
}


// field of view of the iphone 3gs camera (not much accurate)
var viewAngleX = toRad(19);
var viewAngleY = toRad(29);


// filter coeff
var K = 0.5;

// accelerometer variables
var accelX = 0;
var accelY = 0;
var accelZ = 0;
var incl = 0;

 
var gps='calculating';
var address='unknown address';
var updatedHeading = 'calculating';
var heading = 0;
var ok = false;


// current location (updated by GPS)
var currLocation = {lat: 0, lng: 0, alt: 0};

var currBearing = 0;        //current bearing of the device


// When in simulator, fix your position (near to your POIs)
if (Ti.Platform.model == 'Simulator')
{
    currLocation = {lat: 37.0625, lng: -95.677068, alt: 0};    
}

// these are your POIs (random points around Apple HQ)
var locations = [
        {name: 'location 1', lat: 37.331381, lng: -96.23412, alt: 0}, 
        {name: 'location 2', lat: 37.459869, lng: -94.23030, alt: 0}
        ];



// low pass filter
function FilterK(sens, oldVal, k)
{
    return (sens * k) + (oldVal * (1 - k));
}


// Distance and Bearing functions
// borrowed from http://www.movable-type.co.uk/scripts/latlngg.html#ellipsoid

function Distance(point1, point2) {
    var R = 6371; // km
    
    var dLat = toRad(point2.lat-point1.lat);
    var dLon = toRad(point2.lng-point1.lng); 
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(toRad(point1.lat)) * Math.cos(toRad(point2.lat)) * 
        Math.sin(dLon/2) * Math.sin(dLon/2); 
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return R * c;
}


function Bearing(point1, point2) 
{
    Titanium.API.debug('  Bearing Fnct');
  var lat1 = point1.lat * Math.PI/180;
  var lat2 = point2.lat * Math.PI/180;
  var dlng = (point2.lng - point1.lng) * Math.PI/180;

  var y = Math.sin(dlng) * Math.cos(lat2);
  var x = Math.cos(lat1) * Math.sin(lat2) -
          Math.sin(lat1) * Math.cos(lat2) * Math.cos(dlng);
  var brng = Math.atan2(y, x);
    Titanium.API.debug('  brng: ' + brng);
  return brng;
}



// create the overlay view
var overlay = Titanium.UI.createView();

// create bottom message container
var msgView = Titanium.UI.createView({
	height:140,
	width:320,
	bottom:0
});

// create message semi-transparent background
var bgView = Titanium.UI.createView({
	height:140,
	width:320,
	backgroundColor:'#002',
	borderRadius:10,
	opacity:0.7
});
msgView.add(bgView);

// message
var txt = Titanium.UI.createLabel({
	text:'Calculating...',
	color:'#fff',
	font:{fontSize:12,fontWeight:'bold',fontFamily:'Helvetica Neue'},
	textAlign:'center',
	width:'100%',
	height:'auto'
});
msgView.add(txt);
overlay.add(msgView);

function refreshLabel()
{
	var text = "Heading: " + updatedHeading +"°, Location: " + gps;
	if (address)
	{
		text+="\n"+address;
	}
    text += "\n" + "X: " + accelX + " Y: " + accelY;
    text += " Z: " + accelZ;
    text += "\n" + "Incl: " + (180 - toDeg(incl));
	txt.text = text;
}


// these are the views representing POIs
// I create them all at once, even if it might not be the best choice
// Initially they are all invisible

var locViews = [];

//create the views array
for (var i = 0; i < locations.length; i++)
{
    locViews[i] = Titanium.UI.createView({
        height:80,
        width:120,
        visible: false
    });
    
    var bg = Titanium.UI.createView({
        height:80,
        width:120,
        backgroundColor:'#eee',
        borderRadius:10,
        opacity:0.7
    });
    locViews[i].add(bg);
    // message
    var message = Titanium.UI.createLabel({
        text:locations[i].name,
        color:'#111',
        font:{fontSize:12,fontWeight:'normal',fontFamily:'Helvetica Neue'},
        textAlign:'left',
        width:'auto',
        height:'auto'
    });
    locViews[i].add(message);
    locViews[i].msg = message;
    overlay.add(locViews[i]);
}



// I create a top message view where I write the current version of 
// the code
var msgView2 = Titanium.UI.createView({
	height:20,
	width:320,
	top:0
});

var bgView2 = Titanium.UI.createView({
	height:20,
	width:320,
	backgroundColor:'#200',
	borderRadius:10,
	opacity:0.7
});
msgView2.add(bgView2);

// message
var txt2 = Titanium.UI.createLabel({
	text:'Version 1.34',
	color:'#fff',
	font:{fontSize:12,fontWeight:'bold',fontFamily:'Helvetica Neue'},
	textAlign:'left',
	width:'auto',
	height:'auto',
    left: 10
});
msgView2.add(txt2);
overlay.add(msgView2);



//Here I create the circular view that show where POIs are 
//respect to the current position  (as in layar)
var bgCircle = Titanium.UI.createView({
	height:80,
	width:80,
	borderRadius:40,
	backgroundColor:'#111',
	top:40,
	left:210,
    opacity: 0.7
});


var targetImg = Titanium.UI.createImageView({url: 'target.png', height: 80, width:80});

bgCircle.add(targetImg);
overlay.add(bgCircle);

var circle = Titanium.UI.createView({
	height:80,
	width:80,
	borderRadius:40,
    top:40,
	left:210
});

// maxDist is the distance of the farthest POI
var maxDist = 0;

var firstRun = true;


// map POIs on the circular view
function MapLocations()
{
    var circPoints = [];
    for (var i = 0; i < locations.length; i++)
    {
        var dist = Distance(currLocation, locations[i]);
        if (dist > maxDist)
        {
            maxDist = dist;
        }
        var horizAngle = Bearing(currLocation, locations[i]);
        circPoints[i] = {};
        circPoints[i].pt = null;
        circPoints[i].dist = dist;
        circPoints[i].theta = horizAngle;
        Titanium.API.debug("Location: " + locations[i].name + " horizAngle: " + Math.round(toDeg(horizAngle)) + " dist: " + dist);
    }
    
    Titanium.API.debug("MaxDist: " + maxDist);

    
    //maxDist += 0.1;
    
    for (var j = 0; j < locations.length; j++)
    {
        var ro = 40 * circPoints[j].dist / maxDist;
        
        Titanium.API.debug("Location: " + locations[j].name + " ro: " + ro);

        var centerX = 40 + ro * Math.sin(circPoints[j].theta);
        var centerY = 40 - ro * Math.cos(circPoints[j].theta);
        
        Titanium.API.debug("*** CenterX: " + centerX + " centerY: " + centerY);
        
        var bgColor = '#fff';
        
        if (firstRun)
        {
            circPoints[j].pt = Titanium.UI.createView({
                height:6,
                width:6,
                borderRadius:3,
                backgroundColor:bgColor,
                top:centerY - 3,
                left:centerX - 3
            });
            circle.add(circPoints[j].pt); 
        }
        else
        {
            if (circPoints[j].pt != null)
            {
                circPoints[j].pt.top = centerY - 3;
                circPoints[j].pt.left = centerX - 3;
            }
        }
    }
    firstRun = false; 
    
}

//initially the circle is hidden
circle.hide();
overlay.add(circle);



//compute the X displacement from the center of the screen given
//the relative horizontal angle of a POI
function ComputeXDelta(relAngle)
{
    Titanium.API.debug("*** ComputeXDelta");
    Titanium.API.debug("***     relative bearing: " + Math.round(toDeg(relAngle)));
    var res = Math.sin(relAngle) / Math.sin(viewAngleX /2);
    Titanium.API.debug("***     XDelta: " + Math.round(res));
    return res;
}

//compute the Y displacement from the center of the screen, given
//the relative vertical angle of a POI
//(currently not used --> need to manage accelerometer info)
function ComputeYDelta(relAngle)
{
    Titanium.API.debug("*** ComputeXDelta");
    Titanium.API.debug("***     relative Inclination: " + Math.round(toDeg(relAngle)));
    var res = Math.sin(relAngle) / Math.sin(viewAngleY /2);
    Titanium.API.debug("***     XDelta: " + Math.round(res));
    return res;
}


//compute the vertical angle of a location given its distance and
//altitude
//(currently not used)
function VertAngle(loc)
{
    return Math.atan2(loc.alt - currLocation.alt, Distance(currLocation, loc) * 1000);
}


//compute the center X and Y of the screen
var displayCaps = Titanium.Platform.displayCaps;
var centerX = displayCaps.platformWidth/2;
var centerY = displayCaps.platformHeight/2;
    


// Update the overlay view showing POI views 
function UpdateView()
{

    Titanium.API.debug("Display width: " + displayCaps.platformWidth + " height: " + displayCaps.platformHeight);
    for (var i = 0; i < locations.length; i++)
    {
        Titanium.API.debug("location: " + locations[i].name);
        
        var dist = Distance(currLocation, locations[i]);
                
        var horizAngle = Bearing(currLocation, locations[i]);
        var vertAngle = VertAngle(locations[i]);
        var relAngleV = 0;
        if (currLocation.alt > 0)
        {
            relAngleV = vertAngle - (Math.PI - incl);

        }
        
        var relAngleH = horizAngle - currBearing;   
                
        
        Titanium.API.debug("point bearing: " + Math.round(toDeg(horizAngle)));

        
        if (toDeg(relAngleH) >= 90 && toDeg(relAngleH) <= 270)
        {
            Titanium.API.debug("   nothing to do...");
            continue;
        }
         
           
        if (toDeg(relAngleV) >= 90 && toDeg(relAngleV) <= 270)
        {
            Titanium.API.debug("   nothing to do...");
            //continue;
        }
          
        Titanium.API.debug("Checkpoint 1");
        
        var xDelta = ComputeXDelta(relAngleH);
        Titanium.API.debug("   xDelta: " + Math.round(xDelta.toString()));
        
        var yDelta = ComputeYDelta(relAngleV);
        Titanium.API.debug("   yDelta: " + Math.round(yDelta.toString()));

        
        var viewCenterX = xDelta * centerX + centerX;
        //var viewCenterY = yDelta * centerY + centerY;
        var viewCenterY = centerY;
        var currView = locViews[i];
       
    
        currView.left = viewCenterX - currView.width/2;
        currView.top = viewCenterY - currView.height/2;

        if (currView.left > displayCaps.platformWidth ||
            (currView.left + currView.width) < 0)
        {
            currView.hide();
        }
        else
        {
            currView.show();
        }
       

        
    }

}


//update the circular view, given the current heading
function updateCompass()
{

        circle.show();
        var t = Ti.UI.create2DMatrix();
        t = t.rotate(toDeg(-currBearing));
        circle.transform = t;
}



//if we are on the simulator I create a slider view for simulating
//heading changes
if (Ti.Platform.model == 'Simulator')
{
    var myslider = Titanium.UI.createSlider({
			min: 0,
			max: 10,
			value:0,
			width:300,
            top:20
		});
    myslider.addEventListener('change',function(e)
    {
         currBearing = toRad(e.value * 36);
         Ti.API.info('currbearing = ' + currBearing + ' e.value = ' +e.value);
            refreshLabel();
            UpdateView();
            updateCompass();
            MapLocations();
        
    });

overlay.add(myslider);

}

// if we are on a real device we install heading and accelerometer event
// listeners that update the overlay
// currently accelerometer values are not used

if (Ti.Platform.model != 'Simulator')
{
    Titanium.Geolocation.addEventListener('location',function(e)
    {
        currLocation.lng = e.coords.longitude;
        currLocation.lat = e.coords.latitude;
        currLocation.alt = e.coords.altitude;
        gps = 'lat: ' + currLocation.lat.toFixed(6) + ' lng: ' + currLocation.lng.toFixed(6) + ' alt: ' + Math.round(currLocation.alt);
        Titanium.Geolocation.reverseGeocoder(currLocation.lat, currLocation.lng,function(evt)
        {
            var places = evt.places[0];
            address = places.street ? places.street : places.address;
            refreshLabel();
        });
    });



    Titanium.Geolocation.addEventListener('heading',function(e)
    {
        if (e.error)
        {
            updatedHeading.text = 'error: ' + e.error;
            return;
        }
        
        heading = e.heading.magneticHeading; //FilterK(e.heading.magneticHeading, heading, K);
        currBearing = toRad(heading);
        updatedHeading = Math.round(heading);
        ok = true;	
    });



    Titanium.Accelerometer.addEventListener('update',function(e)
    {
        accelX = FilterK(e.x, accelX, K);
        accelZ = FilterK(e.z, accelZ, K);
        accelY = FilterK(e.y, accelY, K);
        incl = Math.atan2(accelZ, accelY);
    });

// I set up a timer in order to sample sensor values with a costant delay
// and for making screen animation a little more fluid

    setInterval(function()
        {
            if (!ok)
            {
                return;
            }
            refreshLabel();
            UpdateView();
            updateCompass();
            MapLocations();
        }, 10);


// create the camera view
    Titanium.Media.showCamera({

        success:function(event)
        {
        },
        cancel:function()
        {
        },
        error:function(error)
        {
            var a = Titanium.UI.createAlertDialog({title:'Camera'});
            if (error.code == Titanium.Media.NO_CAMERA)
            {
                a.setMessage('Please run this test on device');
            }
            else
            {
                a.setMessage('Unexpected error: ' + error.code);
            }
            a.show();
        },
        overlay:overlay,
        showControls:false,	// don't show system controls
        mediaTypes:Ti.Media.MEDIA_TYPE_PHOTO,
        autohide:false 	// tell the system not to auto-hide and we'll do it ourself
    });
}
else
{
	win.add(overlay);
}





