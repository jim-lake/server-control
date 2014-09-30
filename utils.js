
if( typeof String.prototype.format != 'function' )
{
    String.prototype.format = function() 
    {
        var args = arguments;
        return this.replace(/{(\d+)}/g, function(match, number) { 
                            return typeof args[number] != 'undefined'
                            ? args[number]
                            : '{' + number + '}'
                            ;
                            });
    };            
}

if( typeof String.prototype.startsWith != 'function' )
{
    String.prototype.startsWith = function(str)
    {
        return( this.indexOf(str) === 0);
    };
}

if( typeof String.prototype.endsWith != 'function' )
{
    String.prototype.endsWith = function(suffix) 
    {
        return this.indexOf(suffix, this.length - suffix.length) !== -1;
    };
}

if( typeof String.prototype.capitalize != 'function' )
{
    String.prototype.capitalize = function() 
    {
        return this.charAt(0).toUpperCase() + this.slice(1);
    }
}

if( typeof Number.prototype.padZeros != 'function' )
{
    Number.prototype.padZeros = function(length)
    {
        var str = '' + this;
        while (str.length < length)
        {
            str = '0' + str;
        }
        
        return str;
    };
}
if( typeof String.prototype.startsWith != 'function' ) 
{
    String.prototype.startsWith = function(str) 
    {
        return this.slice(0, str.length) == str;
    };
}


