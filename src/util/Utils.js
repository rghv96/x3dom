/*
 * X3DOM JavaScript Library
 * http://www.x3dom.org
 *
 * (C)2009 Fraunhofer IGD, Darmstadt, Germany
 * Dual licensed under the MIT and GPL
 *
 * Based on code originally provided by
 * Philip Taylor: http://philip.html5.org
 */

/*****************************************************************************
* Utils class holds utility functions for renderer
*****************************************************************************/
x3dom.Utils = {};

x3dom.Utils.maxIndexableCoords = 65535;
x3dom.Utils.needLineWidth = false;  // lineWidth not impl. in IE11
x3dom.Utils.measurements = [];

// http://gent.ilcore.com/2012/06/better-timer-for-javascript.html
window.performance = window.performance || {};
performance.now = ( function ()
{
    return performance.now ||
           performance.mozNow ||
           performance.msNow ||
           performance.oNow ||
           performance.webkitNow ||
           function ()
           {
               return new Date().getTime();
           };
} )();

x3dom.Utils.startMeasure = function ( name )
{
    var uname = name.toUpperCase();
    if ( !x3dom.Utils.measurements[ uname ] )
    {
        x3dom.Utils.measurements[ uname ] = performance.now();
    }
};

x3dom.Utils.stopMeasure = function ( name )
{
    var uname = name.toUpperCase();
    if ( x3dom.Utils.measurements[ uname ] )
    {
        var startTime = x3dom.Utils.measurements[ uname ];
        delete x3dom.Utils.measurements[ uname ];
        return performance.now() - startTime;
    }
    return 0;
};

/*****************************************************************************
 *
 *****************************************************************************/
x3dom.Utils.isNumber = function ( n )
{
    return !isNaN( parseFloat( n ) ) && isFinite( n );
};

/*****************************************************************************
*
*****************************************************************************/
x3dom.Utils.createTexture2D = function ( gl, doc, src, bgnd, crossOrigin, scale, genMipMaps, flipY, tex )
{
    flipY = flipY || false;

    var texture = gl.createTexture();

    //Create a black 4 pixel texture to prevent 'texture not complete' warning
    var data = new Uint8Array( [ 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255 ] );
    gl.bindTexture( gl.TEXTURE_2D, texture );
    gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, data );
    if ( genMipMaps )
    {
        gl.generateMipmap( gl.TEXTURE_2D );
    }
    gl.bindTexture( gl.TEXTURE_2D, null );

    texture.ready = false;
    var urlIndex = 0;

    if ( src == null || src == "" )
    {return texture;}

    var image = new Image();

    switch ( crossOrigin.toLowerCase() )
    {
        case "anonymous": {
            image.crossOrigin = "anonymous";
        } break;
        case "use-credentials": {
            image.crossOrigin = "use-credentials";
        } break;
        case "none": {
            //this is needed to omit the default case, if default is none, erase this and the default case
        } break;
        default: {
            if ( x3dom.Utils.forbiddenBySOP( src ) )
            {
                image.crossOrigin = "anonymous";
            }
        }
    }

    var requestImageWithChannelCount = function ()
    {
        if ( tex && tex.getOrigChannelCount() === 0 )
        {
            var xhr = new XMLHttpRequest();
            xhr.open( "GET", src );

            xhr.onloadstart = function ()
            {
                xhr.responseType = "arraybuffer";
            };

            xhr.onload = function ()
            {
                var mimeType  = xhr.getResponseHeader( "Content-Type" ),
                    imageData = new Uint8Array( xhr.response ),
                    channelcount = x3dom.Utils.detectChannelCount( imageData, mimeType );

                if ( channelcount )
                {
                    tex.setOrigChannelCount( channelcount );
                }

                image.src = x3dom.Utils.arrayBufferToObjectURL( imageData, mimeType );
            };

            xhr.onerror = function ()
            {
                x3dom.debug.logError( "[Utils|createTexture2D] Can't http request: " + src );
                // always try to load, to trigger image.onerror if unsuccessful
                image.src = src;
            };

            x3dom.RequestManager.addRequest( xhr );
        }
        else
        {
            image.src = src;
        }

        doc.incrementDownloads();
    };

    requestImageWithChannelCount();

    image.onload = function ()
    {
        texture.originalWidth  = image.width;
        texture.originalHeight = image.height;

        if ( scale )
        {image = x3dom.Utils.scaleImage( image );}

        if ( bgnd == true || flipY == true )
        {
            gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, true );
        }
        gl.bindTexture( gl.TEXTURE_2D, texture );
        //gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image );
        if ( genMipMaps )
        {
            gl.generateMipmap( gl.TEXTURE_2D );
        }
        gl.bindTexture( gl.TEXTURE_2D, null );
        if ( bgnd == true || flipY == true )
        {
            gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, false );
        }

        //Save image size
        texture.width  = image.width;
        texture.height = image.height;
        texture.ready = true;

        doc.decrementDownloads();
        doc.needRender = true;
    };

    image.onerror = function ( error )
    {
        x3dom.Utils.tryDDSLoading( texture, gl, doc, src, genMipMaps, flipY, tex ).then( function ()
        {
            doc.decrementDownloads();
            doc.needRender = true;
        }, function ()
        {
            x3dom.debug.logError( "[Utils|createTexture2D] Can't load Image: " + src );
            doc.decrementDownloads();
            urlIndex++;
            if ( tex && urlIndex < tex._vf.url.length )
            {
                src = tex._nameSpace.getURL( tex._vf.url[ urlIndex ] );
                requestImageWithChannelCount();
            }
        } );
    };

    return texture;
};

x3dom.Utils.tryDDSLoading = function ( texture, gl, doc, src, genMipMaps, flipY, tex )
{
    return x3dom.DDSLoader.load( src ).then( function ( dds )
    {
        if ( !dds || ( dds.isCompressed && !x3dom.caps.COMPRESSED_TEXTURE ) )
        {
            return;
        }

        gl.bindTexture( dds.type, texture );

        flipY = false;

        if ( flipY )
        {
            gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, true );
        }

        if ( !x3dom.Utils.isPowerOfTwo( dds.width ) && !x3dom.Utils.isPowerOfTwo( dds.height ) )
        {
            gl.texParameteri( dds.type, gl.TEXTURE_MAG_FILTER, gl.LINEAR             );
            gl.texParameteri( dds.type, gl.TEXTURE_MIN_FILTER, gl.LINEAR             );
            gl.texParameteri( dds.type, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE     );
            gl.texParameteri( dds.type, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE     );

            dds.generateMipmaps = false;
        }
        else if ( dds.generateMipmaps )
        {
            gl.texParameteri( dds.type, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR );
        }

        for ( var target in dds.data )
        {
            var width  = dds.width;
            var height = dds.height;

            var levels = dds.data[ target ];

            for ( var l = 0; l < levels.length; l++ )
            {
                if ( l != 0 )
                {
                    width  = Math.max( width  * 0.5, 1 );
                    height = Math.max( height * 0.5, 1 );
                }

                if ( dds.format.internal < 33776 || dds.format.internal > 33779 )
                {
                    gl.texImage2D( +target, l, dds.format.internal, width, height, 0, dds.format.format, dds.format.type, levels[ l ] );
                }
                else
                {
                    gl.compressedTexImage2D( +target, l, dds.format.internal, width, height, 0, levels[ l ] );
                    dds.generateMipmaps = false;
                }
            }
        }

        if ( dds.generateMipmaps )
        {
            gl.generateMipmap( dds.type );
        }

        if ( flipY )
        {
            gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, false );
        }

        gl.bindTexture( dds.type, null );

        texture.width  = dds.width;
        texture.height = dds.height;
        texture.ready = true;
        texture.textureCubeReady = true;

        if ( tex && dds.channelCount )
        {
            tex.setOrigChannelCount( dds.channelCount );
        }
    } );
};

/*****************************************************************************
*
*****************************************************************************/
x3dom.Utils.createTextureCube = function ( gl, doc, src, bgnd, crossOrigin, scale, genMipMaps, flipY )
{
    //Create a black 4 pixel texture to prevent 'texture not complete' warning
    var data = new Uint8Array( [ 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255 ] );

    var texture = gl.createTexture();

    var faces;
    if ( bgnd )
    {
        faces = [ gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
            gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
            gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X ];
    }
    else
    {
        //       back, front, bottom, top, left, right
        faces = [ gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
            gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
            gl.TEXTURE_CUBE_MAP_NEGATIVE_X, gl.TEXTURE_CUBE_MAP_POSITIVE_X ];
    }

    texture.ready = false;
    texture.pendingTextureLoads = -1;
    texture.textureCubeReady = false;

    var width = 0,
        height = 0;

    for ( var i = 0; i < faces.length; i++ )
    {
        gl.bindTexture( gl.TEXTURE_CUBE_MAP, texture );
        gl.texImage2D( faces[ i ], 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, data );
        gl.bindTexture( gl.TEXTURE_CUBE_MAP, null );
    }

    if ( src.length == 1 )
    {
        doc.incrementDownloads();

        x3dom.Utils.tryDDSLoading( texture, gl, doc, src[ 0 ], genMipMaps, flipY ).then( function ()
        {
            doc.decrementDownloads();
            doc.needRender = true;
        }, function ()
        {
            x3dom.debug.logError( "[Utils|createTexture2D] Can't load Image: " + src );
            doc.decrementDownloads();
        } );
    }
    else if ( src.length == 6 )
    {
        for ( var i = 0; i < faces.length; i++ )
        {
            var face = faces[ i ];

            var image = new Image();

            switch ( crossOrigin.toLowerCase() )
            {
                case "anonymous": {
                    image.crossOrigin = "anonymous";
                } break;
                case "use-credentials": {
                    image.crossOrigin = "use-credentials";
                } break;
                case "none": {
                    //this is needed to omit the default case, if default is none, erase this and the default case
                } break;
                default: {
                    if ( x3dom.Utils.forbiddenBySOP( src[ i ] ) )
                    {
                        image.crossOrigin = "anonymous";
                    }
                }
            }

            texture.pendingTextureLoads++;
            doc.incrementDownloads();

            image.onload = ( function ( texture, face, image, swap )
            {
                return function ()
                {
                    if ( width == 0 && height == 0 )
                    {
                        width = image.width;
                        height = image.height;
                    }
                    else if ( scale && ( width != image.width || height != image.height ) )
                    {
                        x3dom.debug.logWarning( "[Utils|createTextureCube] Rescaling CubeMap images, which are of different size!" );
                        image = x3dom.Utils.rescaleImage( image, width, height );
                    }

                    gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, swap );

                    gl.bindTexture( gl.TEXTURE_CUBE_MAP, texture );
                    gl.texImage2D( face, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image );
                    gl.bindTexture( gl.TEXTURE_CUBE_MAP, null );
                    gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, false );

                    texture.pendingTextureLoads--;
                    doc.decrementDownloads();

                    if ( texture.pendingTextureLoads < 0 )
                    {
                        //Save image size also for cube tex
                        texture.width  = width;
                        texture.height = height;
                        texture.textureCubeReady = true;

                        if ( genMipMaps )
                        {
                            gl.bindTexture( gl.TEXTURE_CUBE_MAP, texture );
                            gl.generateMipmap( gl.TEXTURE_CUBE_MAP );
                            gl.bindTexture( gl.TEXTURE_CUBE_MAP, null );
                        }

                        x3dom.debug.logInfo( "[Utils|createTextureCube] Loading CubeMap finished..." );
                        doc.needRender = true;
                    }
                };
            } )( texture, face, image, bgnd );

            image.onerror = function ()
            {
                doc.decrementDownloads();

                x3dom.debug.logError( "[Utils|createTextureCube] Can't load CubeMap!" );
            };

            // backUrl, frontUrl, bottomUrl, topUrl, leftUrl, rightUrl (for bgnd)
            image.src = src[ i ];
        }
    }

    return texture;
};

/*****************************************************************************
*
*****************************************************************************/
x3dom.Utils.detectChannelCount = function ( data, mimeType )
{
    switch ( mimeType )
    {
        case "image/jpeg":
            return x3dom.Utils.detectChannelCountJPG( data );
        case "image/png":
            return x3dom.Utils.detectChannelCountPNG( data );
        case "image/gif":
            return x3dom.Utils.detectChannelCountGIF( data );
    }
};

/*****************************************************************************
*
*****************************************************************************/
x3dom.Utils.detectChannelCountJPG = function ( data )
{
    if ( data[ 0 ] != 0xff ) {return;}
    if ( data[ 1 ] != 0xd8 ) {return;}

    var pos = 2;
    var dv = new DataView( data.buffer, data.byteOffset, data.byteLength );

    while ( pos + 4 < data.byteLength )
    {
        if ( data[ pos ] != 0xff )
        {
            pos += 1;
            continue;
        }

        var type = data[ pos + 1 ];

        pos += 2;

        if ( data[ pos ] == 0xff )
        {
            continue;
        }

        var length = dv.getUint16( pos );

        if ( pos + length > data.byteLength )
        {
            return;
        }

        if ( length >= 7 && ( type == 0xc0 || type == 0xc2 ) )
        {
            return data[ pos + 7 ];
        }

        pos += length;
    }

    return;
};

/*****************************************************************************
*
*****************************************************************************/
x3dom.Utils.detectChannelCountPNG = function ( data )
{
    if ( data.byteLength < 29 ) {return;}

    // PNG header
    if ( data[ 0 ] != 0x89 ) {return;}
    if ( data[ 1 ] != 0x50 ) {return;}
    if ( data[ 2 ] != 0x4e ) {return;}
    if ( data[ 3 ] != 0x47 ) {return;}
    if ( data[ 4 ] != 0x0d ) {return;}
    if ( data[ 5 ] != 0x0a ) {return;}
    if ( data[ 6 ] != 0x1a ) {return;}
    if ( data[ 7 ] != 0x0a ) {return;}

    // "IHDR"
    if ( data[ 12 ] != 0x49 ) {return;}
    if ( data[ 13 ] != 0x48 ) {return;}
    if ( data[ 14 ] != 0x44 ) {return;}
    if ( data[ 15 ] != 0x52 ) {return;}

    if ( data[ 25 ] == 0 ) {return 1;}
    if ( data[ 25 ] == 2 ) {return 3;}
    if ( data[ 25 ] == 4 ) {return 2;}
    if ( data[ 25 ] == 6 ) {return 4;}
};

/*****************************************************************************
*
*****************************************************************************/
x3dom.Utils.detectChannelCountGIF = function ( data )
{
    if ( data[ 0 ] != 0x47 ) {return;}
    if ( data[ 1 ] != 0x49 ) {return;}
    if ( data[ 2 ] != 0x46 ) {return;}

    if ( data[ 3 ] != 0x38 ) {return;}
    if ( data[ 4 ] != 0x37 && data[ 4 ] != 0x39 ) {return;}
    if ( data[ 5 ] != 0x61 ) {return;}

    if ( data[ 10 ] & 0x01 )
    {
        var length = data[ 10 ] & 0xE0;

        for ( var i = 13; i < length; i += 3 )
        {
            if ( data[ i ] != data[ i + 1 ] || data[ i ] != data[ i + 2 ] || data[ i + 1 ] != data[ i + 2 ] )
            {
                return 3;
            }
        }

        return 1;
    }

    //TODO check local color table of the image block
};

/*****************************************************************************
 * Initialize framebuffer object and associated texture(s)
 *****************************************************************************/
x3dom.Utils.initFBO = function ( gl, w, h, type, mipMap, needDepthBuf, numMrt )
{
    var tex = gl.createTexture();
    tex.width  = w;
    tex.height = h;

    gl.bindTexture( gl.TEXTURE_2D, tex );
    gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type, null );
    if ( mipMap )
    {gl.generateMipmap( gl.TEXTURE_2D );}
    gl.bindTexture( gl.TEXTURE_2D, null );

    var i,
        mrts = null;

    if ( x3dom.caps.DRAW_BUFFERS && numMrt !== undefined )
    {
        mrts = [ tex ];

        for ( i = 1; i < numMrt; i++ )
        {
            mrts[ i ] = gl.createTexture();
            mrts[ i ].width  = w;
            mrts[ i ].height = h;

            gl.bindTexture( gl.TEXTURE_2D, mrts[ i ] );
            gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type, null );
            if ( mipMap )
            {gl.generateMipmap( gl.TEXTURE_2D );}
            gl.bindTexture( gl.TEXTURE_2D, null );
        }
    }

    var fbo = gl.createFramebuffer();
    var dtex = null;
    var rb = null;

    if ( needDepthBuf )
    {
        if ( x3dom.caps.DEPTH_TEXTURE !== null )
        {
            dtex = gl.createTexture();
            gl.bindTexture( gl.TEXTURE_2D, dtex );
            gl.texImage2D( gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null );
            if ( mipMap )
            {gl.generateMipmap( gl.TEXTURE_2D );}
            gl.bindTexture( gl.TEXTURE_2D, null );
            dtex.width = w;
            dtex.height = h;
        }
        else
        {
            rb = gl.createRenderbuffer();

            gl.bindRenderbuffer( gl.RENDERBUFFER, rb );
            gl.renderbufferStorage( gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h );
            gl.bindRenderbuffer( gl.RENDERBUFFER, null );
        }
    }

    gl.bindFramebuffer( gl.FRAMEBUFFER, fbo );

    gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0 );
    if ( x3dom.caps.DRAW_BUFFERS && numMrt !== undefined )
    {
        for ( i = 1; i < numMrt; i++ )
        {
            gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, mrts[ i ], 0 );
        }
    }

    if ( needDepthBuf && x3dom.caps.DEPTH_TEXTURE !== null )
    {
        gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, dtex, 0 );
    }
    else
    {
        gl.framebufferRenderbuffer( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb );
    }

    var status = gl.checkFramebufferStatus( gl.FRAMEBUFFER );

    if ( status != gl.FRAMEBUFFER_COMPLETE )
    {
        x3dom.debug.logWarning( "[Utils|InitFBO] FBO-Status: " + status );
    }

    gl.bindFramebuffer( gl.FRAMEBUFFER, null );

    return {
        fbo        : fbo,
        dtex       : dtex,
        rbo        : rb,
        tex        : tex,
        texTargets : mrts,
        width      : w,
        height     : h,
        type       : type,
        mipMap     : mipMap
    };
};

/*****************************************************************************
*
*****************************************************************************/
x3dom.Utils.getFileName = function ( url )
{
    var filename;

    if ( url.lastIndexOf( "/" ) > -1 )
    {
        filename = url.substr( url.lastIndexOf( "/" ) + 1 );
    }
    else if ( url.lastIndexOf( "\\" ) > -1 )
    {
        filename = url.substr( url.lastIndexOf( "\\" ) + 1 );
    }
    else
    {
        filename = url;
    }

    return filename;
};

/*****************************************************************************
*
*****************************************************************************/
x3dom.Utils.isWebGL2Enabled = function ()
{
    var canvas = document.createElement( "canvas" );

    var webgl2 = canvas.getContext( "webgl2" ) || canvas.getContext( "experimental-webgl2" );

    return ( webgl2 ) ? true : false;
};

/*****************************************************************************
*
*****************************************************************************/
x3dom.Utils.findTextureByName = function ( texture, name )
{
    for ( var i = 0; i < texture.length; ++i )
    {
        if ( name == texture[ i ].samplerName )
        {return texture[ i ];}
    }
    return false;
};

/*****************************************************************************
* Rescale image to given size
*****************************************************************************/
x3dom.Utils.rescaleImage = function ( image, width, height )
{
    var canvas = document.createElement( "canvas" );
    canvas.width = width; canvas.height = height;
    canvas.getContext( "2d" ).drawImage( image,
        0, 0, image.width, image.height,
        0, 0, canvas.width, canvas.height );
    return canvas;
};

/*****************************************************************************
* Scale image to next best power of two
*****************************************************************************/
x3dom.Utils.scaleImage = function ( image )
{
    if ( !x3dom.Utils.isPowerOfTwo( image.width ) || !x3dom.Utils.isPowerOfTwo( image.height ) )
    {
        var canvas = document.createElement( "canvas" );
        canvas.width = x3dom.Utils.nextHighestPowerOfTwo( image.width );
        canvas.height = x3dom.Utils.nextHighestPowerOfTwo( image.height );
        var ctx = canvas.getContext( "2d" );
        ctx.drawImage( image,
            0, 0, image.width, image.height,
            0, 0, canvas.width, canvas.height );
        image = canvas;
    }
    return image;
};

/*****************************************************************************
* Check if value is power of two
*****************************************************************************/
x3dom.Utils.isPowerOfTwo = function ( x )
{
    return ( ( x & ( x - 1 ) ) === 0 );
};

/*****************************************************************************
* Return next highest power of two
*****************************************************************************/
x3dom.Utils.nextHighestPowerOfTwo = function ( x )
{
    --x;
    for ( var i = 1; i < 32; i <<= 1 )
    {
        x = x | x >> i;
    }
    return ( x + 1 );
};

/*****************************************************************************
* Return next best power of two
*****************************************************************************/
x3dom.Utils.nextBestPowerOfTwo = function ( x )
{
    // use precomputed log(2.0) = 0.693147180559945
    var log2x = Math.log( x ) / 0.693147180559945;
    return Math.pow( 2, Math.round( log2x ) );
};

/*****************************************************************************
* Return data type size in byte
*****************************************************************************/
x3dom.Utils.getDataTypeSize = function ( type )
{
    switch ( type )
    {
        case "Int8":
        case "Uint8":
            return 1;
        case "Int16":
        case "Uint16":
            return 2;
        case "Int32":
        case "Uint32":
        case "Float32":
            return 4;
        case "Float64":
        default:
            return 8;
    }
};

/*****************************************************************************
 * Return offset multiplier (Uint32 is twice as big as Uint16)
 *****************************************************************************/
x3dom.Utils.getOffsetMultiplier = function ( indexType, gl )
{
    switch ( indexType )
    {
        case gl.UNSIGNED_SHORT:
            return 1;
        case gl.UNSIGNED_INT:
            return 2;
        case gl.UNSIGNED_BYTE:
            return 0.5;
        default:
            return 1;
    }
};

/*****************************************************************************
 * Return byte aware offset
 *****************************************************************************/
x3dom.Utils.getByteAwareOffset = function ( offset, indexType, gl )
{
    switch ( indexType )
    {
        case gl.UNSIGNED_SHORT:
            return 2 * offset;
        case gl.UNSIGNED_INT:
            return 4 * offset;
        case gl.UNSIGNED_BYTE:
            return offset;
        default:
            return 2 * offset;
    }
};

/*****************************************************************************
* Return this.gl-Type
*****************************************************************************/
x3dom.Utils.getVertexAttribType = function ( type, gl )
{
    var dataType = gl.NONE;

    switch ( type )
    {
        case "Int8":
            dataType = gl.BYTE;
            break;
        case "Uint8":
            dataType = gl.UNSIGNED_BYTE;
            break;
        case "Int16":
            dataType = gl.SHORT;
            break;
        case "Uint16":
            dataType = gl.UNSIGNED_SHORT;
            break;
        case "Int32":
            dataType = gl.INT;
            break;
        case "Uint32":
            dataType = gl.UNSIGNED_INT;
            break;
        case "Float32":
            dataType = gl.FLOAT;
            break;
        case "Float64":
        default:
            x3dom.debug.logError( "Can't find this.gl data type for " + type + ", getting FLOAT..." );
            dataType = gl.FLOAT;
            break;
    }

    return dataType;
};

/*****************************************************************************
* Return TypedArray View
*****************************************************************************/
x3dom.Utils.getArrayBufferView = function ( type, buffer )
{
    var array = null;

    switch ( type )
    {
        case "Int8":
            array = new Int8Array( buffer );
            break;
        case "Uint8":
            array = new Uint8Array( buffer );
            break;
        case "Int16":
            array = new Int16Array( buffer );
            break;
        case "Uint16":
            array = new Uint16Array( buffer );
            break;
        case "Int32":
            array = new Int32Array( buffer );
            break;
        case "Uint32":
            array = new Uint32Array( buffer );
            break;
        case "Float32":
            array = new Float32Array( buffer );
            break;
        case "Float64":
            array = new Float64Array( buffer );
            break;
        default:
            x3dom.debug.logError( "Can't create typed array view of type " + type + ", trying Float32..." );
            array = new Float32Array( buffer );
            break;
    }

    return array;
};

/*****************************************************************************
* Checks whether a TypedArray View Type with the given name string is unsigned
*****************************************************************************/
x3dom.Utils.isUnsignedType = function ( str )
{
    return ( str == "Uint8" || str == "Uint16" || str == "Uint16" || str == "Uint32" );
};

/*****************************************************************************
* Checks for lighting
*****************************************************************************/
x3dom.Utils.checkDirtyLighting = function ( viewarea )
{
    return ( viewarea.getLights().length + viewarea._scene.getNavigationInfo()._vf.headlight );
};

/*****************************************************************************
 * Checks for PhysicalEnvironmentLight change
 *****************************************************************************/
x3dom.Utils.checkDirtyPhysicalEnvironmentLight = function ( viewarea, shaderProperties )
{
    return ( !!shaderProperties.PHYSICALENVLIGHT != viewarea.hasPhysicalEnvironmentLight() );
};

/*****************************************************************************
 * Checks for environment
 *****************************************************************************/
x3dom.Utils.checkDirtyEnvironment = function ( viewarea, shaderProperties )
{
    var environment = viewarea._scene.getEnvironment();

    return ( shaderProperties.GAMMACORRECTION != environment._vf.gammaCorrectionDefault );
};

/*****************************************************************************
* Get GL min filter
*****************************************************************************/
x3dom.Utils.minFilterDic = function ( gl, minFilter )
{
    switch ( minFilter.toUpperCase() )
    {
        case "NEAREST":                      return gl.NEAREST;
        case "LINEAR":                       return gl.LINEAR;
        case "NEAREST_MIPMAP_NEAREST":       return gl.NEAREST_MIPMAP_NEAREST;
        case "NEAREST_MIPMAP_LINEAR":        return gl.NEAREST_MIPMAP_LINEAR;
        case "LINEAR_MIPMAP_NEAREST":        return gl.LINEAR_MIPMAP_NEAREST;
        case "LINEAR_MIPMAP_LINEAR":         return gl.LINEAR_MIPMAP_LINEAR;
        case "AVG_PIXEL":                    return gl.LINEAR;
        case "AVG_PIXEL_AVG_MIPMAP":         return gl.LINEAR_MIPMAP_LINEAR;
        case "AVG_PIXEL_NEAREST_MIPMAP":     return gl.LINEAR_MIPMAP_NEAREST;
        case "DEFAULT":                      return gl.LINEAR_MIPMAP_LINEAR;
        case "FASTEST":                      return gl.NEAREST;
        case "NEAREST_PIXEL":                return gl.NEAREST;
        case "NEAREST_PIXEL_AVG_MIPMAP":     return gl.NEAREST_MIPMAP_LINEAR;
        case "NEAREST_PIXEL_NEAREST_MIPMAP": return gl.NEAREST_MIPMAP_NEAREST;
        case "NICEST":                       return gl.LINEAR_MIPMAP_LINEAR;
        default:                             return gl.LINEAR;
    }
};

/*****************************************************************************
* Get GL min filter
*****************************************************************************/
x3dom.Utils.minFilterDicX3D = function ( minFilter )
{
    switch ( minFilter )
    {
        case 9728: return "NEAREST";
        case 9729: return "LINEAR";
        case 9984: return "NEAREST_MIPMAP_NEAREST";
        case 9985: return "LINEAR_MIPMAP_NEAREST";
        case 9986: return "NEAREST_MIPMAP_LINEAR";
        case 9987: return "LINEAR_MIPMAP_LINEAR";
        default:   return "LINEAR_MIPMAP_LINEAR";
    }
};

/*****************************************************************************
* Get GL mag filter
*****************************************************************************/
x3dom.Utils.magFilterDic = function ( gl, magFilter )
{
    switch ( magFilter.toUpperCase() )
    {
        case "NEAREST":         return gl.NEAREST;
        case "LINEAR":          return gl.LINEAR;
        case "AVG_PIXEL":       return gl.LINEAR;
        case "DEFAULT":         return gl.LINEAR;
        case "FASTEST":         return gl.NEAREST;
        case "NEAREST_PIXEL":   return gl.NEAREST;
        case "NICEST":          return gl.LINEAR;
        default:                return gl.LINEAR;
    }
};

/*****************************************************************************
* Get X3D mag filter
*****************************************************************************/
x3dom.Utils.magFilterDicX3D = function ( magFilter )
{
    switch ( magFilter )
    {
        case 9728: return "NEAREST";
        case 9729: return "LINEAR";
        default:   return "LINEAR";
    }
};

/*****************************************************************************
* Get GL boundary mode
*****************************************************************************/
x3dom.Utils.boundaryModesDicX3D = function ( mode )
{
    switch ( mode )
    {
        case 10497: return "REPEAT";
        case 33071: return "CLAMP_TO_EDGE";
        case 33648: return "MIRRORED_REPEAT";
        default:    return "REPEAT";
    }
};

/*****************************************************************************
* Get GL boundary mode
*****************************************************************************/
x3dom.Utils.boundaryModesDic = function ( gl, mode )
{
    switch ( mode.toUpperCase() )
    {
        case "CLAMP":             return gl.CLAMP_TO_EDGE;
        case "CLAMP_TO_EDGE":     return gl.CLAMP_TO_EDGE;
        case "CLAMP_TO_BOUNDARY": return gl.CLAMP_TO_EDGE;
        case "MIRRORED_REPEAT":   return gl.MIRRORED_REPEAT;
        case "REPEAT":            return gl.REPEAT;
        default:                  return gl.REPEAT;
    }
};

/*****************************************************************************
 * Get GL primitive type
 *****************************************************************************/
x3dom.Utils.primTypeDic = function ( gl, type )
{
    switch ( type.toUpperCase() )
    {
        case "POINTS":        return gl.POINTS;
        case "LINES":         return gl.LINES;
        case "LINELOOP":      return gl.LINE_LOOP;
        case "LINESTRIP":     return gl.LINE_STRIP;
        case "TRIANGLES":     return gl.TRIANGLES;
        case "TRIANGLESTRIP": return gl.TRIANGLE_STRIP;
        case "TRIANGLEFAN":   return gl.TRIANGLE_FAN;
        default:              return gl.TRIANGLES;
    }
};

/*****************************************************************************
* Get GL depth function
*****************************************************************************/
x3dom.Utils.depthFunc = function ( gl, func )
{
    switch ( func.toUpperCase() )
    {
        case "NEVER":             return gl.NEVER;
        case "ALWAYS":            return gl.ALWAYS;
        case "LESS":              return gl.LESS;
        case "EQUAL":             return gl.EQUAL;
        case "LEQUAL":            return gl.LEQUAL;
        case "GREATER":           return gl.GREATER;
        case "GEQUAL":            return gl.GEQUAL;
        case "NOTEQUAL":          return gl.NOTEQUAL;
        default:                  return gl.LEQUAL;
    }
};

/*****************************************************************************
 * Get GL blend function
 *****************************************************************************/
x3dom.Utils.blendFunc = function ( gl, func )
{
    switch ( func.toLowerCase() )
    {
        case "zero":                        return gl.ZERO;
        case "one":                         return gl.ONE;
        case "dst_color":                   return gl.DST_COLOR;
        case "dst_alpha":                   return gl.DST_ALPHA;
        case "src_color":                   return gl.SRC_COLOR;
        case "src_alpha":                   return gl.SRC_ALPHA;
        case "one_minus_dst_color":         return gl.ONE_MINUS_DST_COLOR;
        case "one_minus_dst_alpha":         return gl.ONE_MINUS_DST_ALPHA;
        case "one_minus_src_color":         return gl.ONE_MINUS_SRC_COLOR;
        case "one_minus_src_alpha":         return gl.ONE_MINUS_SRC_ALPHA;
        case "src_alpha_saturate":          return gl.SRC_ALPHA_SATURATE;
        case "constant_color":              return gl.CONSTANT_COLOR;
        case "constant_alpha":              return gl.CONSTANT_ALPHA;
        case "one_minus_constant_color":    return gl.ONE_MINUS_CONSTANT_COLOR;
        case "one_minus_constant_alpha":    return gl.ONE_MINUS_CONSTANT_ALPHA;
        default:                            return 0;
    }
};

/*****************************************************************************
 * Get GL blend equations
 *****************************************************************************/
x3dom.Utils.blendEquation = function ( gl, func )
{
    switch ( func.toLowerCase() )
    {
        case "func_add":                return gl.FUNC_ADD;
        case "func_subtract":           return gl.FUNC_SUBTRACT;
        case "func_reverse_subtract":   return gl.FUNC_REVERSE_SUBTRACT;
        case "min":                     return 0;  //Not supported yet
        case "max":                     return 0;  //Not supported yet
        case "logic_op":                return 0;  //Not supported yet
        default:                        return 0;
    }
};

/*****************************************************************************
*
*****************************************************************************/
x3dom.Utils.generateProperties = function ( viewarea, shape )
{
    var property = {};

    var geometry    = shape._cf.geometry.node;
    var appearance  = shape._cf.appearance.node;
    var texture     = appearance ? appearance._cf.texture.node : null;
    var material    = appearance ? appearance._cf.material.node : null;
    var environment = viewarea._scene.getEnvironment();

    //Check if it's a composed shader
    if ( appearance && appearance._shader &&
        x3dom.isa( appearance._shader, x3dom.nodeTypes.ComposedShader ) )
    {
        property.CSHADER          = appearance._shader._id; //shape._objectID;
    }
    else if ( geometry )
    {
        property.CSHADER          = -1;
        property.APPMAT           = ( appearance && ( material || property.CSSHADER ) ) ? 1 : 0;
        property.SOLID            = ( shape.isSolid() ) ? 1 : 0;
        property.TEXT             = ( x3dom.isa( geometry, x3dom.nodeTypes.Text ) ) ? 1 : 0;
        property.POPGEOMETRY      = ( x3dom.isa( geometry, x3dom.nodeTypes.PopGeometry ) ) ? 1 : 0;
        property.BUFFERGEOMETRY      = ( x3dom.isa( geometry, x3dom.nodeTypes.BufferGeometry ) ) ? 1 : 0;
        property.BINARYGEOMETRY   = ( x3dom.isa( geometry, x3dom.nodeTypes.BinaryGeometry ) )  ? 1 : 0;
        property.POINTLINE2D      = !geometry.needLighting() ? 1 : 0;
        property.VERTEXID         = ( ( property.BINARYGEOMETRY ) && geometry._vf.idsPerVertex ) ? 1 : 0;
        property.IS_PARTICLE      = ( x3dom.isa( geometry, x3dom.nodeTypes.ParticleSet ) ) ? 1 : 0;
        property.POINTPROPERTIES  = ( appearance && appearance._cf.pointProperties.node ) ? 1 : 0;
        property.TANGENTDATA      = ( geometry._mesh._tangents[ 0 ].length > 0 && geometry._mesh._binormals[ 0 ].length > 0 ) ? 1 : 0;
        property.PBR_MATERIAL     = ( property.APPMAT && x3dom.isa( material, x3dom.nodeTypes.PhysicalMaterial ) ) ? 1 : 0;
        property.TWOSIDEDMAT      = ( property.APPMAT && x3dom.isa( material, x3dom.nodeTypes.TwoSidedMaterial ) ) ? 1 : 0;
        property.SEPARATEBACKMAT  = ( property.TWOSIDEDMAT && material._vf.separateBackColor ) ? 1 : 0;
        property.SHADOW           = ( viewarea.getLightsShadow() ) ? 1 : 0;
        property.FOG              = ( viewarea._scene.getFog()._vf.visibilityRange > 0 ) ? 1 : 0;
        property.CSSHADER         = ( appearance && appearance._shader &&
                                     x3dom.isa( appearance._shader, x3dom.nodeTypes.CommonSurfaceShader ) ) ? 1 : 0;

        property.LIGHTS           = ( !property.POINTLINE2D && appearance && shape.isLit() && ( material || property.CSSHADER ) ) ?
            viewarea.getLights().length + ( viewarea._scene.getNavigationInfo()._vf.headlight ) : 0;
        property.TEXTURED         = ( texture || property.TEXT || ( property.CSSHADER && appearance._shader.needTexcoords() ) ||
                                    ( property.PBR_MATERIAL && material.hasTextures() ) ) ? 1 : 0;
        property.CUBEMAP          = ( texture && x3dom.isa( texture, x3dom.nodeTypes.X3DEnvironmentTextureNode ) ) ||
                                    ( property.CSSHADER && appearance._shader.getEnvironmentMap() ) ? 1 : 0;
        property.PIXELTEX         = ( texture && x3dom.isa( texture, x3dom.nodeTypes.PixelTexture ) ) ? 1 : 0;
        property.TEXTRAFO         = ( appearance && appearance._cf.textureTransform.node ) ? 1 : 0;
        property.DIFFUSEMAP       = ( texture && !x3dom.isa( texture, x3dom.nodeTypes.X3DEnvironmentTextureNode ) ) ||
                                    ( property.CSSHADER && appearance._shader.getDiffuseMap() ) ||
                                    ( property.PBR_MATERIAL && material._cf.baseColorTexture.node ) ? 1 : 0;
        property.NORMALMAP        = ( property.CSSHADER && appearance._shader.getNormalMap() ) ||
                                    ( property.PBR_MATERIAL && material._cf.normalTexture.node ) ? 1 : 0;
        property.SPECMAP          = ( property.CSSHADER && appearance._shader.getSpecularMap() ) ? 1 : 0;
        property.SHINMAP          = ( property.CSSHADER && appearance._shader.getShininessMap() ) ? 1 : 0;
        property.EMISSIVEMAP      = ( property.PBR_MATERIAL && material._cf.emissiveTexture.node ) ? 1 : 0;
        property.OCCLUSIONMAP     = ( property.PBR_MATERIAL && material._cf.occlusionTexture.node ) ? 1 : 0;
        property.DISPLACEMENTMAP  = ( property.CSSHADER && appearance._shader.getDisplacementMap() ) ? 1 : 0;
        property.DIFFPLACEMENTMAP = ( property.CSSHADER && appearance._shader.getDiffuseDisplacementMap() ) ? 1 : 0;

        property.ALPHAMODE            = ( property.PBR_MATERIAL ) ? material._vf.alphaMode : "BLEND";
        property.ISROUGHNESSMETALLIC  = ( property.PBR_MATERIAL && material._vf.model == "roughnessMetallic" ) ? 1 : 0;
        property.ROUGHNESSMETALLICMAP = ( property.PBR_MATERIAL && material._cf.roughnessMetallicTexture.node ) ? 1 : 0;
        property.SPECULARGLOSSINESSMAP = ( property.PBR_MATERIAL && material._cf.specularGlossinessTexture.node ) ? 1 : 0;
        property.OCCLUSIONROUGHNESSMETALLICMAP = ( property.PBR_MATERIAL && material._cf.occlusionRoughnessMetallicTexture.node ) ? 1 : 0;
        property.PHYSICALENVLIGHT = viewarea.hasPhysicalEnvironmentLight() ? 1 : 0;

        property.NORMALSPACE      = ( property.NORMALMAP && property.CSSHADER ) ? appearance._shader._vf.normalSpace.toUpperCase() :
            ( property.NORMALMAP && property.PBR_MATERIAL ) ? material._vf.normalSpace.toUpperCase() : "TANGENT";

        property.BLENDING         = ( property.TEXT || property.CUBEMAP || property.CSSHADER || ( property.PBR_MATERIAL ) || ( texture && texture._blending ) ) ? 1 : 0;
        property.REQUIREBBOX      = ( geometry._vf.coordType !== undefined && geometry._vf.coordType != "Float32" ) ? 1 : 0;
        property.REQUIREBBOXNOR   = ( geometry._vf.normalType !== undefined && geometry._vf.normalType != "Float32" ) ? 1 : 0;
        property.REQUIREBBOXCOL   = ( geometry._vf.colorType !== undefined && geometry._vf.colorType != "Float32" ) ? 1 : 0;
        property.REQUIREBBOXTEX   = ( geometry._vf.texCoordType !== undefined && geometry._vf.texCoordType != "Float32" ) ? 1 : 0;
        property.COLCOMPONENTS    = geometry._mesh._numColComponents;
        property.NORCOMPONENTS    = geometry._mesh._numNormComponents;
        property.POSCOMPONENTS    = geometry._mesh._numPosComponents;
        property.SPHEREMAPPING    = ( geometry._cf.texCoord !== undefined && geometry._cf.texCoord.node !== null &&
                                     geometry._cf.texCoord.node._vf.mode &&
                                     geometry._cf.texCoord.node._vf.mode.toLowerCase() == "sphere" ) ? 1 : 0;
        property.VERTEXCOLOR      = ( geometry._mesh._colors[ 0 ].length > 0 ||
                                     ( property.POPGEOMETRY    && geometry.hasColor() ) ||
                                     ( property.BUFFERGEOMETRY && geometry.hasColor() ) ||
                                     ( geometry._vf.color !== undefined && geometry._vf.color.length > 0 ) ) ? 1 : 0;
        property.CLIPPLANES       = shape._clipPlanes.length;
        property.ALPHATHRESHOLD   = ( appearance ) ? appearance._vf.alphaClipThreshold.toFixed( 2 ) : 0.1;
        property.MULTITEXCOORD    = ( property.BUFFERGEOMETRY && geometry.hasMultiTexCoord() ) ? 1 : 0;

        property.DIFFUSEMAPCHANNEL = ( property.PBR_MATERIAL && property.DIFFUSEMAP && material._cf.baseColorTexture.node._vf.channel === 1 ) ? 1 : 0;
        property.NORMALMAPCHANNEL  = ( property.PBR_MATERIAL && property.NORMALMAP && material._cf.normalTexture.node._vf.channel === 1 ) ? 1 : 0;
        property.EMISSIVEMAPCHANNEL = ( property.PBR_MATERIAL && property.EMISSIVEMAP && material._cf.emissiveTexture.node._vf.channel === 1 ) ? 1 : 0;
        property.OCCLUSIONMAPCHANNEL = ( property.PBR_MATERIAL && property.OCCLUSIONMAP && material._cf.occlusionTexture.node._vf.channel === 1 ) ? 1 : 0;
        property.ROUGHNESSMETALLICMAPCHANNEL = ( property.PBR_MATERIAL && property.ROUGHNESSMETALLICMAP && material._cf.roughnessMetallicTexture.node._vf.channel === 1 ) ? 1 : 0;
        property.OCCLUSIONROUGHNESSMETALLICMAPCHANNEL = ( property.PBR_MATERIAL && property.OCCLUSIONROUGHNESSMETALLICMAP && material._cf.occlusionRoughnessMetallicTexture.node._vf.channel === 1 ) ? 1 : 0;
        property.SPECULARGLOSSINESSMAPCHANNEL = ( property.PBR_MATERIAL && property.SPECULARGLOSSINESSMAP && material._cf.specularGlossinessTexture.node._vf.channel === 1 ) ? 1 : 0;
        property.ALPHAMASK                    = ( property.PBR_MATERIAL && material._vf.alphaMode == "MASK" ) ? 1 : 0;
        property.UNLIT = ( property.PBR_MATERIAL && material._vf.unlit ) ? 1 : 0;

        property.GAMMACORRECTION  = environment._vf.gammaCorrectionDefault;

        property.KHR_MATERIAL_COMMONS = 0;
    }

    property.toIdentifier = function ()
    {
        delete this.id;
        var id = "";
        for ( var p in this )
        {
            if ( this[ p ] != this.toIdentifier && this[ p ] != this.toString )
            {
                id += this[ p ];
            }
        }
        this.id = id;
        return id;
    };

    property.toString = function ()
    {
        var str = "";
        for ( var p in this )
        {
            if ( this[ p ] != this.toIdentifier && this[ p ] != this.toString )
            {
                str += p + ": " + this[ p ] + ", ";
            }
        }
        return str;
    };

    property.toIdentifier();

    return property;
};

/*****************************************************************************
* Returns the linear interpolations between two values
*****************************************************************************/
x3dom.Utils.lerp = function ( value1, value2, amount )
{
    amount = amount < 0 ? 0 : amount;
    amount = amount > 1 ? 1 : amount;
    return value1 + ( value2 - value1 ) * amount;
};

/*****************************************************************************
* Returns "shader" such that "shader.foo = [1,2,3]" magically sets the
* appropriate uniform
*****************************************************************************/
x3dom.Utils.wrapProgram = function ( gl, program, shaderID )
{
    var shader = {
        shaderID : shaderID,
        program  : program
    };

    shader.bind = function ()
    {
        gl.useProgram( program );
    };

    var loc = null;
    var obj = null;
    var i,
        glErr;

    // get uniforms
    var numUniforms = gl.getProgramParameter( program, gl.ACTIVE_UNIFORMS );

    for ( i = 0; i < numUniforms; ++i )
    {
        try
        {
            obj = gl.getActiveUniform( program, i );
        }
        catch ( eu )
        {
            if ( !obj ) {continue;}
        }

        glErr = gl.getError();
        if ( glErr )
        {
            x3dom.debug.logError( "GL-Error (on searching uniforms):"
                + " name=" + obj.name
                + " type=" + obj.type
                + " size=" + obj.size
                + " Err=" + glErr );
        }

        loc = gl.getUniformLocation( program, obj.name );

        switch ( obj.type )
        {
            case gl.SAMPLER_2D:
                shader.__defineSetter__( obj.name,
                    ( function ( loc ) { return function ( val ) { gl.uniform1i( loc, val ); }; } )( loc ) );
                break;
            case gl.SAMPLER_CUBE:
                shader.__defineSetter__( obj.name,
                    ( function ( loc ) { return function ( val ) { gl.uniform1i( loc, val ); }; } )( loc ) );
                break;
            case gl.BOOL:
                shader.__defineSetter__( obj.name,
                    ( function ( loc ) { return function ( val ) { gl.uniform1i( loc, val ); }; } )( loc ) );
                break;
            case gl.FLOAT:
                /*
                 * Passing a MFFloat type into uniform.
                 * by Sofiane Benchaa, 2012.
                 *
                 * Based on OpenGL specification.
                 * url: http://www.opengl.org/sdk/docs/man/xhtml/glGetUniformLocation.xml
                 *
                 * excerpt : Except if the last part of name indicates a uniform variable array,
                 * the location of the first element of an array can be retrieved by using the name of the array,
                 * or by using the name appended by "[0]".
                 *
                 * Detecting the float array and extracting its uniform name without the brackets.
                 */
                if ( obj.name.indexOf( "[0]" ) != -1 )
                {
                    shader.__defineSetter__( obj.name.substring( 0, obj.name.length - 3 ),
                        ( function ( loc ) { return function ( val ) { gl.uniform1fv( loc, new Float32Array( val ) ); }; } )( loc ) );
                }
                else
                {
                    shader.__defineSetter__( obj.name,
                        ( function ( loc ) { return function ( val ) { gl.uniform1f( loc, val ); }; } )( loc ) );
                }
                break;
            case gl.FLOAT_VEC2:
                shader.__defineSetter__( obj.name,
                    ( function ( loc ) { return function ( val ) { gl.uniform2f( loc, val[ 0 ], val[ 1 ] ); }; } )( loc ) );
                break;
            case gl.FLOAT_VEC3:
                /* Passing arrays of vec3. see above.*/
                if ( obj.name.indexOf( "[0]" ) != -1 )
                {
                    shader.__defineSetter__( obj.name.substring( 0, obj.name.length - 3 ),
                        ( function ( loc ) { return function ( val ) { gl.uniform3fv( loc, new Float32Array( val ) ); }; } )( loc ) );
                }
                else
                {
                    shader.__defineSetter__( obj.name,
                        ( function ( loc ) { return function ( val ) { gl.uniform3f( loc, val[ 0 ], val[ 1 ], val[ 2 ] ); }; } )( loc ) );
                }
                break;
            case gl.FLOAT_VEC4:
                shader.__defineSetter__( obj.name,
                    ( function ( loc ) { return function ( val ) { gl.uniform4f( loc, val[ 0 ], val[ 1 ], val[ 2 ], val[ 3 ] ); }; } )( loc ) );
                break;
            case gl.FLOAT_MAT2:
                shader.__defineSetter__( obj.name,
                    ( function ( loc ) { return function ( val ) { gl.uniformMatrix2fv( loc, false, new Float32Array( val ) ); }; } )( loc ) );
                break;
            case gl.FLOAT_MAT3:
                shader.__defineSetter__( obj.name,
                    ( function ( loc ) { return function ( val ) { gl.uniformMatrix3fv( loc, false, new Float32Array( val ) ); }; } )( loc ) );
                break;
            case gl.FLOAT_MAT4:
                shader.__defineSetter__( obj.name,
                    ( function ( loc ) { return function ( val ) { gl.uniformMatrix4fv( loc, false, new Float32Array( val ) ); }; } )( loc ) );
                break;
            case gl.INT:
                shader.__defineSetter__( obj.name,
                    ( function ( loc ) { return function ( val ) { gl.uniform1i( loc, val ); }; } )( loc ) );
                break;
            default:
                x3dom.debug.logWarning( "GLSL program variable " + obj.name + " has unknown type " + obj.type );
        }
    }

    // get attributes
    var numAttribs = gl.getProgramParameter( program, gl.ACTIVE_ATTRIBUTES );

    for ( i = 0; i < numAttribs; ++i )
    {
        try
        {
            obj = gl.getActiveAttrib( program, i );
        }
        catch ( ea )
        {
            if ( !obj ) {continue;}
        }

        glErr = gl.getError();
        if ( glErr )
        {
            x3dom.debug.logError( "GL-Error (on searching attributes):"
                + " name=" + obj.name
                + " type=" + obj.type
                + " size=" + obj.size
                + " Err=" + glErr );
        }

        loc = gl.getAttribLocation( program, obj.name );
        shader[ obj.name ] = loc;
    }

    return shader;
};

/**
 * Converts a UTF-8 Uint8Array to a string
 * @param {String} uri_string
 * @returns {boolean}
 */
x3dom.Utils.arrayBufferToJSON = function ( array, offset, length )
{
    offset = ( offset != undefined ) ? offset : 0;
    length = ( length != undefined ) ? length : array.length;

    var out,
        i,
        len,
        c,
        char2,
        char3;

    out = "";
    len = length;
    i = offset;

    while ( i < len )
    {
        c = array[ i++ ];

        switch ( c >> 4 )
        {
            case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
            // 0xxxxxxx
                out += String.fromCharCode( c );
                break;
            case 12: case 13:
            // 110x xxxx   10xx xxxx
                char2 = array[ i++ ];
                out += String.fromCharCode( ( ( c & 0x1F ) << 6 ) | ( char2 & 0x3F ) );
                break;
            case 14:
            // 1110 xxxx  10xx xxxx  10xx xxxx
                char2 = array[ i++ ];
                char3 = array[ i++ ];
                out += String.fromCharCode( ( ( c & 0x0F ) << 12 ) |
                           ( ( char2 & 0x3F ) << 6 ) |
                           ( ( char3 & 0x3F ) << 0 ) );
                break;
        }
    }

    return JSON.parse( out );
};

x3dom.Utils.arrayBufferToObjectURL = function ( buffer, mimetype )
{
    return URL.createObjectURL( new Blob( [ new Uint8Array( buffer ) ], {type: mimetype} ) );
};

x3dom.Utils.dataURIToObjectURL = function ( dataURI )
{
    if ( dataURI.indexOf( "data:" ) == -1 )
    {
        return dataURI;
    }

    var parts        = dataURI.split( "," );
    var mimetype     = parts[ 0 ].split( ":" )[ 1 ].split( ";" )[ 0 ];
    var data         = parts[ 1 ];
    var binaryString = window.atob( data );
    var byteLength   = binaryString.length;
    var bytes        = new Uint8Array( byteLength );

    for ( var i = 0; i < byteLength; i++ )
    {
        bytes[ i ] = binaryString.charCodeAt( i );
    }

    return URL.createObjectURL( new Blob( [ bytes ], {type: mimetype} ) );
};

x3dom.Utils.arrayBufferToDataURL = function ( buffer, mimetype )
{
    var binary = "";

    var bytes = new Uint8Array( buffer );

    for ( var i = 0; i < bytes.byteLength; i++ )
    {
        binary += String.fromCharCode( bytes[ i ] );
    }

    return "data:" + mimetype + ";base64," + window.btoa( binary );
};

/**
 * Matches a given URI with document.location. If domain, port and protocol are the same SOP won't forbid access to the resource.
 * @param {String} uri_string
 * @returns {boolean}
 */
x3dom.Utils.forbiddenBySOP = function ( uri_string )
{
    uri_string = uri_string.toLowerCase();
    // scheme ":" hier-part [ "?" query ] [ "#" fragment ]
    var Scheme_AuthorityPQF = uri_string.split( "//" ); //Scheme and AuthorityPathQueryFragment
    var Scheme,
        AuthorityPQF,
        Authority,
        UserInfo_HostPort,
        HostPort,
        Host_Port,
        Port,
        Host;
    var originPort = document.location.port === "" ? "80" : document.location.port;

    if ( Scheme_AuthorityPQF.length === 2 )
    { // if there is '//' authority is given;
        Scheme = Scheme_AuthorityPQF[ 0 ];
        AuthorityPQF = Scheme_AuthorityPQF[ 1 ];

        /*
         * The authority component is preceded by a double slash ("//") and is
         * terminated by the next slash ("/"), question mark ("?"), or number
         * sign ("#") character, or by the end of the URI.
         */
        Authority = AuthorityPQF.split( "/" )[ 0 ].split( "?" )[ 0 ].split( "#" )[ 0 ];

        //authority   = [ userinfo "@" ] host [ ":" port ]
        UserInfo_HostPort = Authority.split( "@" );
        if ( UserInfo_HostPort.length === 1 )
        { //No Userinfo given
            HostPort = UserInfo_HostPort[ 0 ];
        }
        else
        {
            HostPort = UserInfo_HostPort[ 1 ];
        }

        Host_Port = HostPort.split( ":" );
        Host = Host_Port[ 0 ];
        Port = Host_Port[ 1 ];
    } // else will return false for an invalid URL or URL without authority

    Port = Port || originPort;
    Host = Host || document.location.host;
    Scheme = Scheme || document.location.protocol;
    return !( Port === originPort && Host === document.location.host && Scheme === document.location.protocol );
};
