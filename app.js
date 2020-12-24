// node.js - https://nodejs.org/en/
// express framework - https://expressjs.com/en/4x/api.html
const express=require('express');
var app=express();

const ISOcountries=require("./dvb-common/ISOcountries.js");
const dvbi=require("./dvb-common/DVB-I_definitions.js")

// libxmljs - https://github.com/marudor/libxmljs2
const libxml=require('libxmljs2');

// morgan - https://github.com/expressjs/morgan
const morgan=require('morgan')

const fs=require('fs'), path=require('path');

// command line arguments - https://github.com/75lb/command-line-args
const commandLineArgs=require('command-line-args');

const https=require('https');
const keyFilename=path.join('.','selfsigned.key'), certFilename=path.join('.','selfsigned.crt');

// SLEPR == Service List Entry Point Registry
const MASTER_SLEPR_FILE=path.join('.','slepr-master.xml');
var masterSLEPR="";

// permitted query parameters
const allowed_arguments=[dvbi.e_ProviderName, dvbi.a_regulatorListFlag, dvbi.e_Language, dvbi.e_TargetCountry, dvbi.e_Genre];

// command line options
const DEFAULT_HTTP_SERVICE_PORT=3000;
const optionDefinitions=[
  { name: 'urls', alias: 'u', type: Boolean, defaultValue: false},
  { name: 'port', alias: 'p', type: Number, defaultValue:DEFAULT_HTTP_SERVICE_PORT },
  { name: 'sport', alias: 's', type: Number, defaultValue:DEFAULT_HTTP_SERVICE_PORT+1 }
]


const DVB_COMMON_DIR='dvb-common',
      COMMON_REPO_RAW="https://raw.githubusercontent.com/paulhiggs/dvb-common/master/"
	  
const ISO3166_FILE=path.join('dvb-common','iso3166-countries.json'),
      ISO3166_URL=COMMON_REPO_RAW + "iso3166-countries.json"
	  
var knownCountries=new ISOcountries(false, true);

const IANAlanguages=require('./dvb-common/IANAlanguages.js');

// curl from https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry
const IANA_Subtag_Registry_Filename=path.join('./dvb-common','language-subtag-registry'),
      IANA_Subtag_Registry_URL="https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry"
var knownLanguages=new IANAlanguages();


var metrics={
	numRequests:0,
	numFailed:0
}

morgan.token('protocol', function getProtocol(req) {
	return req.protocol;
});
morgan.token('parseErr',function getParseErr(req) {
	if (req.parseErr) return "("+req.parseErr+")";
	return "";
});
morgan.token('agent',function getAgent(req) {
	return "("+req.headers['user-agent']+")";
});

app.use(morgan(':remote-addr :protocol :method :url :status :res[content-length] - :response-time ms :agent :parseErr'));


/**
 * determines if a value is in a set of values - simular to 
 *
 * @param {String or Array} values The set of values to check existance in
 * @param {String} value The value to check for existance
 * @return {boolean} if value is in the set of values
 */
function isIn(args, value){
	if (typeof(args)=="string")
		return args==value;
	
	if (typeof(args)=="object") 
		return args.includes(value)
	
	return false;
}


/**
 * constructs an XPath based on the provided arguments
 * @param {string} SCHEMA_PREFIX Used when constructing Xpath queries
 * @param {string} elementName the name of the element to be searched for
 * @param {int} index the instance of the named element to be searched for (if specified)
 * @returns {string} the XPath selector
 */
function xPath(SCHEMA_PREFIX, elementName, index=null) {
	return SCHEMA_PREFIX+":"+elementName+(index?"["+index+"]":"")
}


app.get('/query', function(req,res){
	metrics.numRequests++
	if (!checkQuery(req)) {
		res.status(400);
		metrics.numFailed++
	}
	else {
		let slepr=libxml.parseXmlString(masterSLEPR)

		let SLEPR_SCHEMA={}, SCHEMA_PREFIX=slepr.root().namespace().prefix()
		SLEPR_SCHEMA[SCHEMA_PREFIX]=slepr.root().namespace().href();
			
		if (req.query.ProviderName) {
			// if ProviderName is specified, remove any ProviderOffering entries that do not match the name
			let prov, p=0, providerCleanup=[]
			while (prov=slepr.get('//'+xPath(SCHEMA_PREFIX, dvbi.e_ProviderOffering, ++p), SLEPR_SCHEMA)) {
				let provName, n=0, matchedProvider=false
				while ((provName=prov.get(xPath(SCHEMA_PREFIX, dvbi.e_Provider)+'/'+xPath(SCHEMA_PREFIX, dvbi.e_Name, ++n), SLEPR_SCHEMA)) && !matchedProvider) {
					if (isIn(req.query.ProviderName, provName.text())) 
						matchedProvider=true;					
				}
				if (!matchedProvider) 
					providerCleanup.push(prov);
			}
			providerCleanup.forEach(provider => provider.remove());
		}

		if (req.query.regulatorListFlag || req.query.Language || req.query.TargetCountry || req.query.Genre) {
			let prov, p=0, servicesToRemove=[]
			while (prov=slepr.get('//'+xPath(SCHEMA_PREFIX, dvbi.e_ProviderOffering, ++p), SLEPR_SCHEMA)) {
				let serv, s=0
				while (serv=prov.get(xPath(SCHEMA_PREFIX, dvbi.e_ServiceListOffering, ++s), SLEPR_SCHEMA)) {
					let removeService=false
				
					// remove services that do not match the specified regulator list flag
					if (req.query.regulatorListFlag) {
						// The regulatorListFlag has been specified in the query, so it has to match. Default in instance document is "false"
						let flag=serv.attr(dvbi.a_regulatorListFlag)?serv.attr(dvbi.a_regulatorListFlag).value():"false"
						if (req.query.regulatorListFlag!=flag ) 
							removeService=true;
					}

					// remove remaining services that do not match the specified language
					if (!removeService && req.query.Language) {
						let lang, l=0, keepService=false, hasLanguage=false
						while (!keepService && (lang=serv.get(xPath(SCHEMA_PREFIX, dvbi.e_Language, ++l), SLEPR_SCHEMA))) {
							if (isIn(req.query.Language, lang.text())) keepService=true;
							hasLanguage=true;
						}
						if (hasLanguage && !keepService) removeService=true;
					}
					
					// remove remaining services that do not match the specified target country
					if (!removeService && req.query.TargetCountry) {
						let targetCountry, c=0, keepService=false, hasCountry=false
						while (!keepService && (targetCountry=serv.get(xPath(SCHEMA_PREFIX, dvbi.e_TargetCountry, ++c), SLEPR_SCHEMA))) {	
							// note that the <TargetCountry> element can signal multiple values. Its XML pattern is "\c\c\c(,\c\c\c)*"
							let countries=targetCountry.text().split(",")
							countries.forEach(country => {
								if (isIn(req.query.TargetCountry, country)) keepService=true;
							})
							hasCountry=true;
						}
						if (hasCountry && !keepService) removeService=true;
					}

					// remove remaining services that do not match the specified genre
					if (!removeService && req.query.Genre) {
						let genre, g=0, keepService=false, hasGenre=false
						while (!keepService && (genre=serv.get(xPath(SCHEMA_PREFIX, dvbi.e_Genre, ++g), SLEPR_SCHEMA))) {			
							if (isIn(req.query.Genre, genre.text())) keepService=true;
							hasGenre=true;
						}
						if (hasGenre && !keepService) removeService=true;
					}
				
					if (removeService) servicesToRemove.push(serv);						
				}
			}
			servicesToRemove.forEach(service => service.remove());
		}
			
		// remove any <ProviderOffering> elements that no longer have any <ServiceListOffering>
		let prov, p=0, providersToRemove=[]
		while (prov=slepr.get('//'+xPath(SCHEMA_PREFIX, dvbi.e_ProviderOffering, ++p), SLEPR_SCHEMA)) {
			if (!prov.get(xPath(SCHEMA_PREFIX, dvbi.e_ServiceListOffering, 1), SLEPR_SCHEMA)) 
				providersToRemove.push(prov);
		}
		providersToRemove.forEach(provider => provider.remove());
		
		res.type('text/xml');
		res.send(slepr.toString());
	}
	res.end();
});


function isTVAAudioLanguageType(languageCode) {
	// any language specified should be an XML language
	const languageRegex=/[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*/g;
	let s=languageCode.match(languageRegex);
	return s?s[0]===languageCode:false;
}


function checkQuery(req) {
	
/*	function isGenre(genre) {
		// DVB-I Genre is defined through classification schemes
		// permitted values through TVA:ContentCS, TVA:FormatCS, DVB-I:ContentSubject 
		return true;
	}

	function isProvider(provider) {
		return true;
	} */
	
	if (req.query) {
		
		// check for any erronous arguments
		for (key in req.query) {
			if (!isIn(allowed_arguments, key)) {
				req.parseErr="invalid argument ["+key+"]";
				return false;
			}
		}
		
		//regulatorListFlag needs to be a boolean, "true" or "false" only
		if (req.query.regulatorListFlag) {
			if (typeof(req.query.regulatorListFlag)!="string") {
				req.parseErr="invalid type for regulatorListFlag ["+typeof(req.query.regulatorListFlag)+"]";
				return false;
			}
			if (req.query.regulatorListFlag!="true" && req.query.regulatorListFlag!="false") {
				req.parseErr="invalid value for regulatorListFlag ["+req.query.regulatorListFlag+"]";
				return false;				
			}
		}
		
		//TargetCountry(s)
		if (req.query.TargetCountry) {
			if (typeof(req.query.TargetCountry)=="string") {
				if (!knownCountries.isISO3166code(req.query.TargetCountry)) {
					req.parseErr="incorrect country ["+req.query.TargetCountry+"]";
					return false;
				}					
			}	
			else if (typeof(req.query.TargetCountry)=="object") {
				for (let i=0; i<req.query.TargetCountry.length; i++ ) {
					if (!knownCountries.isISO3166code(req.query.TargetCountry[i])) {
						req.parseErr="incorrect country ["+req.query.TargetCountry[i]+"]";
						return false;
					}
				}
			}
		}

		//Language(s)
		if (req.query.Language) {
			if (typeof(req.query.Language)=="string") {
				if (!isTVAAudioLanguageType(req.query.Language)) {
					req.parseErr="incorrect language ["+req.query.Language+"]";
					return false;
				}					
			}	
			else if (typeof(req.query.Language)=="object") {
				for (let i=0; i<req.query.Language.length; i++ ) {
					if (!isTVAAudioLanguageType(req.query.Language[i])) {
						req.parseErr="incorrect language ["+req.query.Language[i]+"]";
						return false;
					}
				}
			}
		}
/* value space of these arguments is not checked
		// Genre(s)
		if (req.query.Genre) {
			if (typeof(req.query.Genre)=="string"){
				if (!isGenre(req.query.Genre)) {
					return false;
				}					
			}	
			else if (typeof(req.query.Genre)=="object") {
				for (let i=0; i<req.query.Genre.length; i++ ) {
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
				for (let i=0; i<req.query.ProviderName.length; i++ ) {
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


/**
 * read in the master XML document as text
 *
 * @param {string} filename   filename of the master XML document
 */
function loadServiceListRegistry(filename) {
	fs.readFile(filename, {encoding: 'utf-8'}, function(err,data){
		if (!err) {
			masterSLEPR=data.replace(/(\r\n|\n|\r|\t)/gm,"");
		} else {
			console.log(err);
		}
	});	
}

app.get('/reload', function(req,res) {
	loadServiceListRegistry(MASTER_SLEPR_FILE);
	knownCountries.loadCountriesFromFile(ISO3166_FILE, true);
	res.status(200).end();
});


app.get('/stats', function(req,res) {
	console.log("knownLanguages.length=", knownLanguages.languagesList.length);
	console.log("knownCountries.length=", knownCountries.count());
	console.log("requests=", metrics.numRequests, " failed=", metrics.numFailed)
	res.status(200).end();
});

app.get('*', function(req,res) {
	res.status(404).end();
});


function loadDataFiles(useURLs) {
	if (useURLs) 
		knownCountries.loadCountriesFromURL(ISO3166_URL, true)
	else knownCountries.loadCountriesFromFile(ISO3166_FILE, true)

	if (useURLs) 
		knownLanguages.loadLanguagesFromURL(IANA_Subtag_Registry_URL, true)
	else knownLanguages.loadLanguagesFromFile(IANA_Subtag_Registry_Filename, true)
}

const options=commandLineArgs(optionDefinitions);


loadDataFiles(options.urls)
loadServiceListRegistry(MASTER_SLEPR_FILE);


// start the HTTP server
var http_server=app.listen(options.port, function() {
	console.log("HTTP listening on port number", http_server.address().port);
});


// start the HTTPS server
// sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout ./selfsigned.key -out selfsigned.crt

function readmyfile(filename) {
	try {
		let stats=fs.statSync(filename);
		if (stats.isFile()) return fs.readFileSync(filename); 
	}
	catch (err) {console.log(err.code,err.path);}
	return null;
}

var https_options = {
	key:readmyfile(keyFilename),
	cert:readmyfile(certFilename)
};

if (https_options.key && https_options.cert) {
	if (options.sport==options.port)
		options.sport=options.port+1
		
	var https_server=https.createServer(https_options, app);
	https_server.listen(options.sport, function(){
		console.log("HTTPS listening on port number", https_server.address().port);
	});
}