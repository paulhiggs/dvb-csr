// node.js - https://nodejs.org/en/
// express framework - https://expressjs.com/en/4x/api.html
var express = require('express');
var app = express();

// morgan - https://github.com/expressjs/morgan
var morgan = require('morgan')

// libxmljs - https://github.com/libxmljs/libxmljs
var libxml = require("libxmljs");

var fs=require("fs"), path=require("path");
var masterCSR, library;

// sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout ./selfsigned.key -out selfsigned.crt
const https=require('https');
const keyFile=path.join('.','selfsigned.key'), certFile=path.join('.','selfsigned.crt');

const HTTP_SERVICE_PORT = 3000;
const HTTPS_SERVICE_PORT=HTTP_SERVICE_PORT+1;

const MASTER_CSR_FILE = "csr-master.xml";
const CSR_SCHEMA =  {'sld':'urn:dvb:metadata:servicelistdiscovery:2019'};

const allowed_arguments = ['ProviderName', 'regulatorListFlag', 'Language', 'TargetCountry', 'Genre'];

morgan.token('protocol', function getProtocol(req) {
	return req.protocol;
});
morgan.token('parseErr',function getParseErr(req) {
	if (req.parseErr) return "("+req.parseErr+")";
	return "";
});

app.use(morgan(':remote-addr :protocol :method :url :status :res[content-length] - :response-time ms :parseErr'));


function isIn(args, value){
	if (typeof(args) == "string")
		return args==value;
	
	if (typeof(args) == "object") {
		for (var x=0; x<args.length; x++) 
			if (args[x] == value)
				return true;
	}
	return false;
}


app.get('/query', function(req,res){
	if (!checkQuery(req)) {
		res.status(400);
	}
	else {
		var doc = libxml.parseXmlString(masterCSR);

		if (req.query.ProviderName) {
			// if ProviderName is specified, remove any ProviderOffering entries that do not match the name
			var p=1, providerCleanup = [];
			var prov=doc.get('//sld:ProviderOffering['+p+']', CSR_SCHEMA);
			while (prov) {
				var n=1, matchedProvider=false;
				var provName=prov.get('//sld:ProviderOffering['+p+']/sld:Provider/sld:Name['+n+']', CSR_SCHEMA);
				while (provName && !matchedProvider) {
					if (isIn(req.query.ProviderName, provName.text())) {
						matchedProvider=true;
					}						
					n++;
					provName=prov.get('//sld:ProviderOffering['+p+']/sld:Provider/sld:Name['+n+']', CSR_SCHEMA);
				}
				if (!matchedProvider) {
					providerCleanup.push(prov);
				}
				p++;
				prov=doc.get('//sld:ProviderOffering['+p+']', CSR_SCHEMA);	
			}
			providerCleanup.forEach(provider => provider.remove());
		}

		if (req.query.regulatorListFlag || req.query.Language || req.query.TargetCountry || req.query.Genre) {
			var p=1, s=1, servicesToRemove=[];
			var prov=doc.get('//sld:ProviderOffering['+p+']', CSR_SCHEMA);			
			while (prov) {
				var s=1;
				var serv=prov.get('//sld:ProviderOffering['+p+']'+'/sld:ServiceListOffering['+s+']', CSR_SCHEMA);
				while (serv) {
					var removeService=false;
				
					// remove services that do not match the specified regulator list flag
					if (req.query.regulatorListFlag) {
						// The regulatorListFlag has been specified in the query, so it has to match. Default in instance document is "false"
						var flag=serv.attr("regulatorListFlag");
						if (flag) flag=flag.value(); else flag="false";
						if (req.query.regulatorListFlag != flag) {
							// remove this service entry
							removeService=true;
						}
					}

					// remove remaining services that do not match the specified language
					if (!removeService && req.query.Language) {
						var l=1, keepService=false;
						var lang=prov.get('//sld:ProviderOffering['+p+']'+'/sld:ServiceListOffering['+s+']'+'/sld:Language['+l+']', CSR_SCHEMA);
						while (!keepService && lang) {
							if (isIn(req.query.Language, lang.text())) keepService=true;
							l++;
							lang=prov.get('//sld:ProviderOffering['+p+']'+'/sld:ServiceListOffering['+s+']'+'/sld:Language['+l+']', CSR_SCHEMA);
						}
						if (!keepService) removeService=true;
					}
					
					// remove remaining services that do not match the specified target country
					if (!removeService && req.query.TargetCountry) {
						var c=1, keepService=false;
						var country=prov.get('//sld:ProviderOffering['+p+']'+'/sld:ServiceListOffering['+s+']'+'/sld:TargetCountry['+c+']', CSR_SCHEMA);
						while (!keepService && country) {	
							if (isIn(req.query.TargetCountry, country.text())) keepService=true;
							c++;
							country=prov.get('//sld:ProviderOffering['+p+']'+'/sld:ServiceListOffering['+s+']'+'/sld:TargetCountry['+c+']', CSR_SCHEMA);
						}
						if (!keepService) removeService=true;
					}

					// remove remaining services that do not match the specified genre
					if (!removeService && req.query.Genre) {
						var g=1, keepService=false;
						var genre=prov.get('//sld:ProviderOffering['+p+']'+'/sld:ServiceListOffering['+s+']'+'/sld:Genre['+g+']', CSR_SCHEMA);
						while (!keepService && genre) {			
							if (isIn(req.query.Genre, genre.text())) keepService=true;
							g++;
							genre=prov.get('//sld:ProviderOffering['+p+']'+'/sld:ServiceListOffering['+s+']'+'/sld:Genre['+g+']', CSR_SCHEMA);
						}
						if (!keepService) removeService=true;
					}
				
					if (removeService) {
						servicesToRemove.push(serv);						
					}
					s++;
					serv=doc.get('//sld:ProviderOffering['+p+']'+'/sld:ServiceListOffering['+s+']', CSR_SCHEMA);			
				}
				p++;
				prov=doc.get('//sld:ProviderOffering['+p+']', CSR_SCHEMA);
			}
			servicesToRemove.forEach(service => service.remove());
		}
			
		// remove any <ProviderOffering> that no longer have any <ServiceListOffering>
		var p=1, providersToRemove=[];
		var prov=doc.get('//sld:ProviderOffering['+p+']', CSR_SCHEMA);
		while (prov) {
			if (!doc.get('//sld:ProviderOffering['+p+']'+'/sld:ServiceListOffering[1]', CSR_SCHEMA)) 
				providersToRemove.push(prov);
			p++;
			prov=doc.get('//sld:ProviderOffering['+p+']', CSR_SCHEMA);
		}
		providersToRemove.forEach(provider => provider.remove());
		
		res.type('text/xml');
		res.send(doc.toString());
	}
	res.end();
});




function isTVAAudioLanguageType(languageCode) {
	// TV Anytime language is an XML language with some additional addtributes
	// http://www.datypic.com/sc/xsd/t-xsd_language.html
	// any validation should occur through instance document validation. no range check is necessary
	return true;
}

function isISO3166code(countryCode) {
	if (countryCode.length!=3) {
		return false;
	}
	return true;
}

function isGenre(genre) {
	// DVB-I Genre is defined through classification schemes
	// permitted values through TVA:ContentCS, TVA:FormatCS, DVB-I:ContentSubject 
	return true;
}

function isProvider(provider) {
	return true;
}

function checkQuery(req) {
	if (req.query) {
		
		// check for any erronous arguments
		for (key in req.query) {
			if (!isIn(allowed_arguments, key)) {
				req.parseErr = "invalid argument [" + key +"]";
				return false;
			}
		}
		
		//regulatorListFlag needs to be a boolean, "true" or "false" only
		if (req.query.regulatorListFlag) {
			if (typeof(req.query.regulatorListFlag) != "string" ) {
				req.parseErr = "invalid type for regulatorListFlag ["+typeof(req.query.regulatorListFlag)+"]";
				return false;
			}
			if (req.query.regulatorListFlag != "true" && req.query.regulatorListFlag != "false") {
				req.parseErr = "invalid value for regulatorListFlag ["+req.query.regulatorListFlag+"]";
				return false;				
			}
		}
		
		//TargetCountry(s)
		if (req.query.TargetCountry) {
			if (typeof(req.query.TargetCountry)=="string"){
				if (!isISO3166code(req.query.TargetCountry)) {
					req.parseErr = "incorrect length for country ["+req.query.TargetCountry+"]";
					return false;
				}					
			}	
			else if (typeof(req.query.TargetCountry)=="object") {
				var i;
				for (i=0; i<req.query.TargetCountry.length; i++ ) {
					if (!isISO3166code(req.query.TargetCountry[i])) {
						req.parseErr = "incorrect length for country ["+req.query.TargetCountry[i]+"]";
						return false;
					}
				}
			}
		}
/* value space of these arguments is not checked
		//Language(s)
		if (req.query.Language) {
			if (typeof(req.query.Language)=="string"){
				if (!isTVAAudioLanguageType(req.query.Language)) {
					return false;
				}					
			}	
			else if (typeof(req.query.Language)=="object") {
				var i;
				for (i=0; i<req.query.Language.length; i++ ) {
					if (!isTVAAudioLanguageType(req.query.Language[i])) {
						return false;
					}
				}
			}
		}
		// Genre(s)
		if (req.query.Genre) {
			if (typeof(req.query.Genre)=="string"){
				if (!isGenre(req.query.Genre)) {
					return false;
				}					
			}	
			else if (typeof(req.query.Genre)=="object") {
				var i;
				for (i=0; i<req.query.Genre.length; i++ ) {
					if (!isGenre(req.query.Genre[i])) {
						return false;
					}
				}
			}
		}		
		//Provider Name(s)
		if (req.query.ProviderName) {
			if (typeof(req.query.ProviderName)=="string"){
				if (!isProvider(req.query.ProviderName)) {
					return false;
				}					
			}	
			else if (typeof(req.query.ProviderName)=="object") {
				var i;
				for (i=0; i<req.query.ProviderName.length; i++ ) {
					if (!isProvider(req.query.ProviderName[i])) {
						return false;
					}
				}
			}
		}			
*/
	}	
	return true;
}

function loadServiceListRegistry() {
	fs.readFile(MASTER_CSR_FILE, {encoding: 'utf-8'}, function(err,data){
		if (!err) {
			masterCSR = data.replace(/(\r\n|\n|\r|\t)/gm,"");
		} else {
			console.log(err);
		}
	});	
}

app.get('/reload', function(req,res){
	loadServiceListRegistry();
	res.status(200).end();
});

app.get('*', function(req,res) {
	res.status(404).end();
});


loadServiceListRegistry();

// start the HTTP server

var http_server = app.listen(HTTP_SERVICE_PORT, function() {
	console.log("HTTP listening on port number", http_server.address().port);
});


// start the HTTPS server

function readmyfile(filename) {
	try {
		var stats=fs.statSync(filename);
		if (stats.isFile()) return fs.readFileSync(filename); 
	}
	catch (err) {console.log(err);}
	return null;
}

var https_options = {
	key:readmyfile(path.join('.','selfsigned.key')),
	cert:readmyfile(path.join('.','selfsigned.crt'))
};

if (https_options.key && https_options.cert) {
	var https_server = https.createServer(https_options, app);
	https_server.listen(HTTPS_SERVICE_PORT, function(){
		console.log("HTTPS listening on port number", https_server.address().port);
	});
}