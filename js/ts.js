'use strict';


function assert(condition, message) {
    if (!condition) {
        error(message);
    }
};

var Stream = (function stream() {
    function constructor(url) {
        this.url = url;
        console.info("stream url :" + url);
    }

    constructor.prototype = {
        readAll: function (progress, complete) {
            var xhr = new XMLHttpRequest();
            var async = true;
            xhr.open("GET", this.url, async);
            xhr.responseType = "arraybuffer";
            if (progress) {
                xhr.onprogress = function (event) {
                    progress(xhr.response, event.loaded, event.total);
                };
            }
            xhr.onreadystatechange = function (event) {
                if (xhr.readyState === 4) {
                    console.info("xhr.readState === 4, call complete");
                    complete(xhr.response);
                    // var byteArray = new Uint8Array(xhr.response);
                    // var array = Array.prototype.slice.apply(byteArray);
                    // complete(array);
                }
            }
            xhr.send(null);
        }
    };
    return constructor;
})();

/**
 * Represents a 2-dimensional size value.
 */
var Size = (function size() {
    function constructor(w, h) {
        this.w = w;
        this.h = h;
    }

    constructor.prototype = {
        toString: function () {
            return "(" + this.w + ", " + this.h + ")";
        },
        getHalfSize: function () {
            return new Size(this.w >>> 1, this.h >>> 1);
        },
        length: function () {
            return this.w * this.h;
        }
    };
    return constructor;
})();


var Bytestream = (function BytestreamClosure() {
    function constructor(arrayBuffer, start, length) {
        this.bytes = new Uint8Array(arrayBuffer);
        this.start = start || 0;
        this.pos = this.start;
        this.end = (start + length) || this.bytes.length;
    }

    constructor.prototype = {
        get length() {
            return this.end - this.start;
        },
        get position() {
            return this.pos;
        },
        get remaining() {
            return this.end - this.pos;
        },
        readU8Array: function (length) {
            if (this.pos > this.end - length)
                return null;
            var res = this.bytes.subarray(this.pos, this.pos + length);
            this.pos += length;
            return res;
        },
        readU32Array: function (rows, cols, names) {
            cols = cols || 1;
            if (this.pos > this.end - (rows * cols) * 4)
                return null;
            if (cols == 1) {
                var array = new Uint32Array(rows);
                for (var i = 0; i < rows; i++) {
                    array[i] = this.readU32();
                }
                return array;
            } else {
                var array = new Array(rows);
                for (var i = 0; i < rows; i++) {
                    var row = null;
                    if (names) {
                        row = {};
                        for (var j = 0; j < cols; j++) {
                            row[names[j]] = this.readU32();
                        }
                    } else {
                        row = new Uint32Array(cols);
                        for (var j = 0; j < cols; j++) {
                            row[j] = this.readU32();
                        }
                    }
                    array[i] = row;
                }
                return array;
            }
        },
        read8: function () {
            return this.readU8() << 24 >> 24;
        },
        readU8: function () {
            if (this.pos >= this.end)
                return null;
            return this.bytes[this.pos++];
        },
        read16: function () {
            return this.readU16() << 16 >> 16;
        },
        readU16: function () {
            if (this.pos >= this.end - 1)
                return null;
            var res = this.bytes[this.pos + 0] << 8 | this.bytes[this.pos + 1];
            this.pos += 2;
            return res;
        },
        read24: function () {
            return this.readU24() << 8 >> 8;
        },
        readU24: function () {
            var pos = this.pos;
            var bytes = this.bytes;
            if (pos > this.end - 3)
                return null;
            var res = bytes[pos + 0] << 16 | bytes[pos + 1] << 8 | bytes[pos + 2];
            this.pos += 3;
            return res;
        },
        peek32: function (advance) {
            var pos = this.pos;
            var bytes = this.bytes;
            if (pos > this.end - 4)
                return null;
            var res = bytes[pos + 0] << 24 | bytes[pos + 1] << 16 | bytes[pos + 2] << 8 | bytes[pos + 3];
            if (advance) {
                this.pos += 4;
            }
            return res;
        },
        read32: function () {
            return this.peek32(true);
        },
        readU32: function () {
            return this.peek32(true) >>> 0;
        },
        read4CC: function () {
            var pos = this.pos;
            if (pos > this.end - 4)
                return null;
            var res = "";
            for (var i = 0; i < 4; i++) {
                res += String.fromCharCode(this.bytes[pos + i]);
            }
            this.pos += 4;
            return res;
        },
        readFP16: function () {
            return this.read32() / 65536;
        },
        readFP8: function () {
            return this.read16() / 256;
        },
        readISO639: function () {
            var bits = this.readU16();
            var res = "";
            for (var i = 0; i < 3; i++) {
                var c = (bits >>> (2 - i) * 5) & 0x1f;
                res += String.fromCharCode(c + 0x60);
            }
            return res;
        },
        readUTF8: function (length) {
            var res = "";
            for (var i = 0; i < length; i++) {
                res += String.fromCharCode(this.readU8());
            }
            return res;
        },
        readPString: function (max) {
            var len = this.readU8();
            assert(len <= max);
            var res = this.readUTF8(len);
            this.reserved(max - len - 1, 0);
            return res;
        },
        skip: function (length) {
            this.seek(this.pos + length);
        },
        reserved: function (length, value) {
            for (var i = 0; i < length; i++) {
                assert(this.readU8() == value);
            }
        },
        seek: function (index) {
            if (index < 0 || index > this.end) {
                error("Index out of bounds (bounds: [0, " + this.end + "], index: " + index + ").");
            }
            this.pos = index;
        },
        subStream: function (start, length) {
            return new Bytestream(this.bytes.buffer, start, length);
        }
    };
    return constructor;
})();


var TSReader = (function reader() {

    function constructor(stream) {
        this.stream = stream;
        this.frames = [];
        this.audioFrames = [];
        this.videoPID = -1;
        this.audioPID = -1;
    }

    constructor.prototype = {
        readTSHeader: function (stream) {
            var header = {};
            header.sync_byte = stream.readU8(); // :8 同步字节，总是0x47（0100 0111），10进制71, 表示这个包是正确的ts包
            var tp = stream.readU8();
            header.transport_error_indicator = tp >>> 7 & 0x01;  // :1 传输错误指示符，1:暂且定义为本包有个无法修复的错误
            header.payload_unit_start_indicator = tp >>> 6 & 0x01;  // :1 负载单位开始指示符，1: PES或者PSI的开始部分，0：其他
            header.transport_priority = tp >>> 5 & 0x01;  // :1 传输优先指示符，1: 比相同PID的包有更高的优先级
            header.pid = (tp & 0x1F) << 8 | stream.readU8();  // :13 Packet ID
            var ep = stream.readU8();
            header.transport_scrambling_control = ep >>> 6 & 0x03; // :2 加扰控制指示符, 00：未加扰（俗称清流）；01：留着等以后使用,
                                                                  // 10：以even key方式加扰；11：以odd key方式加扰
            header.adaption_field_control = ep >>> 4 & 0x03; // :2 适配区存在指示符
                                                            //00：留着等以后使用；
                                                            //01：本报不含适配区，只有负载区
                                                            //10：本包只含适配区，没有负载区
                                                            //11：本包不仅含有适配区，还含有负载区
                                                            //其实可以把这两bit分开来理解，第一个bit指示是否有适配区，第二个指示是否有负载区
            header.continuity_counter = ep & 0x0F; //当本包目前有负载区时，它才回递增
                                                   //例如，当上面的字段为01or11时，本字段才回递增
            return header;
        },
        readPAT: function (stream) {
            stream.readU8();
            var pat = {};
            pat.table_id = stream.readU8(); //固定为0x00，标志是该表是PAT
            var tp = stream.readU8();
            pat.section_syntax_indicator = tp >>> 7 & 0x01; // :1 //段语法标志位，固定为1
            pat.zero = tp >>> 6 & 0x01; // :1 //0
            pat.reserved_1 = tp >>> 5 & 0x03; // :2 // 保留位
            pat.section_length = ((tp & 0x0F) << 8) | stream.readU8(); // :12 //表示这个字节后面有用的字节数，包括CRC32
            pat.transport_stream_id = stream.readU16(); // :16 //该传输流的ID，区别于一个网络中其它多路复用的流
            tp = stream.readU8();
            pat.reserved_2 = tp >>> 6 & 0x03; // :2 // 保留位
            pat.version_number = tp >>> 1 & 0x1F; // :5; //范围0-31，表示PAT的版本号
            pat.current_next_indicator = tp & 0x01; // :1; //发送的PAT是当前有效还是下一个PAT有效
            pat.section_number = stream.readU8(); // :8; //分段的号码。PAT可能分为多段传输，第一段为00，以后每个分段加1，最多可能有256个分段
            pat.last_section_number = stream.readU8(); // :8; 最后一个分段的号码
            var N = 1;
            if (pat.section_length > 13) {
                N = (pat.section_length - 9) / 4;
            }
            if (pat.current_next_indicator == 0) {
                console.info("PAT Table is not applicable!");
            } else {
                pat.pmts = [];
                for (var i = 0; i < N; i++) {
                    var pmt = {};
                    pmt.program_num = stream.readU16();
                    pmt.network_PID = stream.readU16();
                    pat.pmts.push(pmt);
                }
            }
            pat.crc = stream.readU8Array(4);
            return pat;
        },
        processStreamInfo: function (info) {
            switch (info.stream_type) {
                case  0x00:
                    console.info("ITU-T | ISO/IEC reserved:");
                    break;
                case  0x01:
                    console.info("ISO/IEC 11172 Video:");
                    //ts - > video_PID = stream_descriptor[i].elementary_PID;
                    //has_MPEG_video = 1;
                    break;
                case  0x02:
                    console.info("ITU-T Rec. H.262 | ISO/IEC 13818-2 Video or ISO/IEC 11172-2 constrained parameter video stream:");
                    //ts->video_PID = stream_descriptor[i].elementary_PID;
                    //has_MPEG_video = 1;
                    break;
                case  0x03:
                    console.info("ISO/IEC 11172 Audio:");
                    this.audioPID = info.elementary_PID;
                    break;
                case  0x04:
                    console.info("ISO/IEC 13818-3 Audio:");
                    this.audioPID = info.elementary_PID;
                    break;
                case  0x05:
                    console.info("ITU-T Rec. H.222.0 | ISO/IEC 13818-1 private_section:");
                    break;
                case  0x06:
                    console.info("ITU-T Rec. H.222.0 | ISO/IEC 13818-1 PES packet containing private data:");
                    break;
                case  0x07:
                    console.info("ISO/IEC 13522 MHEG:");
                    break;
                case  0x08:
                    console.info("ITU-T Rec. H.222.0 | ISO/IEC 13818-1 Annex A DSMCC:");
                    break;
                case  0x09:
                    console.info("ITU-T Rec. H.222.1:");
                    break;
                case  0x0a:
                    console.info("ISO/IEC 13818-6 type A:");
                    break;
                case  0x0B:
                    console.info("ISO/IEC 13818-6 type B:");
                    break;
                case  0x0c:
                    console.info("ISO/IEC 13818-6 type C:");
                    break;
                case  0x0D:
                    console.info("ISO/IEC 13818-6 type D:");
                    break;
                case  0x0E:
                    console.info("ITU-T Rec. H.222.0 | ISO/IEC 13818-1 auxiliary:");
                    break;
                case  0x0F:
                    console.info("ISO/IEC 13818-7 Audio with ADTS transport syntax:");
                    this.audioPID = info.elementary_PID;
                    break;
                case  0x10:
                    console.info("ISO/IEC 14496-2 Visual:");
                    //ts->video_PID = stream_descriptor[i].elementary_PID;
                    //ts->is_mpeg4_video = 1;
                    //has_MPEG_video = 1;
                    break;
                case  0x11:
                    console.info("ISO/IEC 14496-3 Audio with the LATM transport syntax as defined in ISO/IEC 14496-3 / AMD1:");
                    this.audioPID = info.elementary_PID;
                    break;
                case  0x12:
                    console.info("ISO/IEC 14496-1 SL-packetized stream or FlexMux stream carried in PES packets:");
                    break;
                case  0x13:
                    console.info("ISO/IEC 14496-1 SL-packetized stream or FlexMux stream carried in ISO/IEC 14496-sections:");
                    break;
                case  0x14:
                    console.info("ISO/IEC 13818-6 Synchronized Download Protocol:");
                    break;
            }
            if (info.stream_type >= 0x15 && info.stream_type <= 0x7F) {
                //console.info("ITU-T Rec. H.222.0 | ISO/IEC 13818-1 reserved:");
                console.info("H.264/AVC Visual:");
                //ts - > video_PID = stream_descriptor[i].elementary_PID;
                //has_h264_tag = 1;
                //has_MPEG_audio = 1;
                this.videoPID = info.elementary_PID;
            }

            if (info.stream_type >= 0x80 && info.stream_type <= 0xFF) {
                console.info("User Private:");
                //ts - > private_PID = stream_descriptor[i].elementary_PID;
            }
            console.info("elementary_PID is " + info.elementary_PID);
        },
        readPMT: function (stream) {
            stream.readU8();
            var pmt = {};
            pmt.table_id = stream.readU8(); //: 8; //固定为0x02, 表示PMT表
            var tp = stream.readU8();
            pmt.section_syntax_indicator = tp >>> 7 & 0x01; // :1 //段语法标志位，固定为1
            pmt.zero = tp >>> 6 & 0x01; // :1 //0
            pmt.reserved_1 = tp >>> 5 & 0x03; // :2 // 保留位
            pmt.section_length = ((tp & 0x0F) << 8) | stream.readU8(); // : 12;//首先两位bit置为00，它指示段的byte数，由段长度域开始，包含CRC。
            pmt.program_number = stream.readU16(); //  :16;// 指出该节目对应于可应用的Program map PID
            tp = stream.readU8();
            pmt.reserved_2 = tp >>> 6 & 0x03; // :2 // 保留位
            pmt.version_number = tp >>> 1 & 0x1F; // :5; //指出TS流中Program map section的版本号
            pmt.current_next_indicator = tp & 0x01; // :1; //当该位置1时，当前传送的Program map section可用；
            //当该位置0时，指示当前传送的Program map section不可用，下一个TS流的Program map section有效。
            pmt.section_number = stream.readU8(); // :8  //固定为0x00
            pmt.last_section_number = stream.readU8(); // : 8; //固定为0x00
            tp = stream.readU8();
            pmt.reserved_3 = tp >>> 5 & 0x07; //: 3; //0x07
            pmt.PCR_PID = (tp & 0x1F) | stream.readU8(); //: 13; //指明TS包的PID值，该TS包含有PCR域，
            //该PCR值对应于由节目号指定的对应节目。
            //如果对于私有数据流的节目定义与PCR无关，这个域的值将为0x1FFF。
            tp = stream.readU8();
            pmt.reserved_4 = tp >>> 4 & 0x0F; //  : 4; //预留为0x0F
            pmt.program_info_length = (tp & 0x0F) | stream.readU8(); //  : 12; //前两位bit为00。该域指出跟随其后对节目信息的描述的byte数。

            var N = pmt.section_length - 9 - 4;
            pmt.streamsInfo = [];
            if (N > 0) {
                var readLen = 0;
                for (var i = 0; i < 32; i++) {
                    var info = {};
                    info.stream_type = stream.readU8();
                    tp = stream.readU8();
                    info.reserved_5 = tp >>> 5;
                    info.elementary_PID = ((tp & 0x1F) << 8 ) | stream.readU8();
                    tp = stream.readU8();
                    info.ES_info_length = (tp & 0x0F) << 8 | stream.readU8();
                    this.processStreamInfo(info);
                    pmt.streamsInfo.push(info);
                    if (info.ES_info_length > 0) {
                        stream.skip(info.ES_info_length);
                    }
                    readLen = readLen + 5 + info.ES_info_length;
                    if (readLen + 5 > N) {
                        break;
                    }
                }
            }
            pmt.crc = stream.readU8Array(4);
            return pmt;
        },
        readSDT: function (stream) {
            stream.readU8();
            var sdt = {};
            sdt.table_id = stream.readU8(); //:8bits的ID,可以是0x42,表示描述的是当前流的信息,也可以是0x46,表示是其他流的信息(EPG使用此参数)
            var tp = stream.readU8();
            sdt.section_syntax_indicator = tp >>> 7 & 0x01; // :1 //段语法标志位，一般为1
            sdt.reserved_future_used = tp >>> 5 & 0x03; // :2 // 保留位
            sdt.reserved_1 = tp >>> 4 & 0x01; //:1bit保留位,防止控制字冲突,一般是''0'',也有可能是''1''
            sdt.section_length = ((tp & 0x0F) << 8) | stream.readU8(); // :12bits的段长度,单位是Bytes,从transport_stream_id开始,到CRC_32结束(包含)
            sdt.transport_stream_id = stream.readU16(); //  :16bits当前描述的流ID
            tp = stream.readU8();
            sdt.reserved_2 = tp >>> 6 & 0x03; // :2 // 保留位
            sdt.version_number = tp >>> 1 & 0x1F; // :5 bits的版本号码,如果数据更新则此字段递增1
            sdt.current_next_indicator = tp & 0x01; //:当前未来标志,一般是''0'',表示当前马上使用.
            sdt.section_number = stream.readU8();
            sdt.last_section_number = stream.readU8();
            sdt.original_netword_id = stream.readU16(); //:16bits的原始网络ID号
            sdt.reserved_future_use = stream.readU8(); // :8bits保留未来使用位接下来是N个节目信息的循环:

            var N = sdt.section_length - 4 - 8;

            sdt.servicesInfo = [];
            if (N > 0) {
                var readLen = 0;
                for (var i = 0; i < 32; i++) {
                    var info = {};
                    info.service_id = stream.readU16(); // :16 bits的服务器ID,实际上就是PMT段中的program_number.
                    tp = stream.readU8();
                    info.reserved_future_used = tp >>> 6 & 0x3F; // :6bits保留未来使用位
                    info.EIT_schedule_flag = tp >>> 1 & 0x01; // :1bit的EIT信息,1表示当前流实现了该节目的EIT传送
                    info.EIT_present_following_flag = tp & 0x01; // :1bits的EIT信息,1表示当前流实现了该节目的EIT传送
                    tp = stream.readU8();
                    info.running_status = tp >>> 5 & 0x07; //:3bits的运行状态信息:1-还未播放 2-几分钟后马上开始,3-被暂停播出,4-正在播放,其他---保留
                    info.free_CA_mode = tp >>> 4 & 0x01; //:1bits的加密信息,''1''表示该节目被加密. 紧接着的是描述符,
                                                       // 一般是Service descriptor,分析此描述符可以获取servive_id指定的节目的节目名称.
                                                       // 具体格式请参考 EN300468中的Service descriptor部分
                    info.descriptors_loop_length = (tp & 0x0F << 8) | stream.readU8();

                    var descReadLen = 0;
                    info.descs = [];
                    var readErr = false;
                    while(true){
                        var desc = {};
                        desc.tag = stream.readU8();
                        desc.length = stream.readU8();
                        if (desc.length > 0) {
                            desc.service_type = stream.readU8();
                            desc.service_provider_name_length = stream.readU8();
                            if (info.descriptors_loop_length > desc.service_provider_name_length + 4) {
                                desc.service_provider_name = stream.readUTF8(desc.service_provider_name_length);
                                desc.service_name_length = stream.readU8();
                                if (info.descriptors_loop_length >= desc.service_provider_name_length + 5 + desc.service_name_length) {
                                    desc.service_name = stream.readUTF8(desc.service_name_length);
                                }else{
                                    readErr = true;
                                }
                            }else{
                                readErr = true;
                            }
                        }
                        descReadLen = 5 + desc.service_name_length + desc.service_provider_name_length;
                        console.info("sdt type=" + desc.service_type + ", provider = " + desc.service_provider_name + ":" + desc.service_name);
                        info.descs.push(desc);
                        if (readErr){
                            break;
                        }
                        if (descReadLen >= info.descriptors_loop_length){
                            break;
                        }
                    }
                    if (readErr){
                        console.error("read ts sdt desc error.");
                        break;
                    }
                    sdt.servicesInfo.push(info);
                    readLen = readLen + 5 + descReadLen;
                    if (readLen + 5 > N) {
                        break;
                    }
                }
            }

            return sdt;
        },
        readAdaptationField: function (stream) {
            var ada = {};
            ada.error = false;
            ada.adaptation_field_length = stream.readU8(); // :8, //本区域除了本字节剩下的长度（不包含本字节！！！切记）
            if (ada.adaptation_field_length > 0) {
                var startPos = this.stream.remaining;
                var tp = stream.readU8();
                ada.discontinuity_indicator = tp >>> 7 & 0x01; //1：本ts包在continuity_counter或者PCR，是处于不连续状态的
                ada.random_access_indicator = tp >>> 6 & 0x01; //可随机访问指示符
                //1：本包中的PES包可以启动一个视频/音频序列
                //就是说如果是1，可以从这个包开始牵出该条ES流
                ada.elementary_stream_priority_indicator = tp >>> 5 & 0x01; //es流优先级指示符
                //1：当同pid时，该es流有更高级的优先权
                ada.PCR_flag = tp >>> 4 & 0x01; //Program Clock Reference，含有“节目时钟参考”标志; 1：适配区里面含有PCR field字段，0：不含有
                ada.OPCR_flag = tp >>> 3 & 0x01;
                ada.splicing_point_flag = tp >>> 2 & 0x01; //1：适配区里面含有splice_countdown字段
                ada.trasport_private_data_flag = tp >>> 1 & 0x01; //1：适配区里面含有private_data_bytes字段
                ada.adaptation_field_extension_flag = tp & 0x01; //1：适配去里面含有adaptation_field_extension字段

                if (ada.PCR_flag == 1) {
                    ada.PCR = this.stream.readU8Array(6);
                }
                if (ada.OPCR_flag == 1) {
                    ada.OPCR = this.stream.readU8Array(6);
                }
                if (ada.splicing_point_flag == 1) {
                    ada.spliceCountdown = this.stream.readU8();
                }
                if (ada.trasport_private_data_flag == 1) {
                    ada.trasport_private_data_len = this.stream.readU8();
                    if (ada.trasport_private_data_len > 0) {
                        ada.trasport_private_data = this.stream.readU8Array(ada.trasport_private_data_len);
                    }
                }
                if (ada.adaptation_field_extension_flag == 1) {
                    //console.info("adaptation_field_extension_flag = 1");
                }
                var unreadLen = ada.adaptation_field_length - (startPos - this.stream.remaining);
                if (unreadLen > 0) {
                    //console.info("ada skip size=" + unreadLen);
                    this.stream.skip(unreadLen);
                } else if (unreadLen < 0) {
                    ada.error = true;
                }
            }
            return ada;
        },
        readPESHeader: function (stream) {
            var pes = {};
            pes.prefix = stream.readU8Array(3); // :24 Packet start code prefix
            pes.streamId = stream.readU8(); // :8 Stream id
            pes.packetLen = stream.readU16(); // :16 PES Packet length 6
            var headerFlag1 = stream.readU8(); //
            var headerFlag2 = stream.readU8(); //:2 10 :14 packet header flag
            pes.headFlag = {};
            pes.headFlag.PES_scrambling_control = headerFlag1 >>> 4 & 0x03;
            pes.headFlag.PES_priority = headerFlag1 >>> 3 & 0x01;
            pes.headFlag.data_alignment_indicator = headerFlag1 >>> 2 & 0x01;
            pes.headFlag.copyright = headerFlag1 >>> 1 & 0x01;
            pes.headFlag.original_or_copy = headerFlag1 & 0x01;
            pes.headFlag.PTS_flags = headerFlag2 >>> 7 & 0x01;
            pes.headFlag.DTS_flags = headerFlag2 >>> 6 & 0x01;
            pes.headFlag.ESCR_flag = headerFlag2 >>> 5 & 0x03;
            pes.headFlag.ES_rate_flag = headerFlag2 >>> 4 & 0x03;
            pes.headFlag.DSM_trick_mode_flag = headerFlag2 >>> 3 & 0x03;
            pes.headFlag.additional_copy_info_flag = headerFlag2 >>> 2 & 0x03;
            pes.headFlag.PES_CRC_flag = headerFlag2 >>> 1 & 0x03;
            pes.headFlag.PES_extension_flag = headerFlag2 & 0x03;

            pes.headerLen = stream.readU8(); // :16 packet len
            if (pes.headerLen > 0) {
                var s = new Bytestream(stream.readU8Array(pes.headerLen));
                if (pes.headFlag.PTS_flags == 1 && s.remaining >= 5) {
                    /*
                     * Parse MPEG-PES five-byte timestamp
                     * buf = pes->header + 9
                     static inline int64_t ff_parse_pes_pts(const uint8_t *buf) {
                     return (int64_t)(*buf & 0x0e) << 29 |
                     (AV_RB16(buf+1) >> 1) << 15 |
                     AV_RB16(buf+3) >> 1;
                     }
                     */
                    pes.pts = ((s.readU8() & 0x0e) << 29 | (s.readU16() >>> 1) << 15 | s.readU16() >>> 1) / 90;
                }
                if (pes.headFlag.DTS_flags == 1 && s.remaining >= 5) {
                    pes.dts = ((s.readU8() & 0x0e) << 29 | (s.readU16() >>> 1) << 15 | s.readU16() >>> 1) / 90;
                }
            }

            return pes;
        },
        readVideoFrame: function (stream) {
            var pes = this.readPESHeader(stream);
            var frame = {};
            frame.pts = pes.pts || 0;
            frame.data = stream.readU8Array(stream.remaining);
            this.frames.push(frame);
        },
        readAudioFrame: function (stream) {
            var pes = this.readPESHeader(stream);
            var frame = {};
            frame.pts = pes.pts || 0;
            frame.data = stream.readU8Array(stream.remaining);
            this.audioFrames.push(frame);
        },
        read: function () {
            var start = (new Date).getTime();

            var readErr = false;
            var allPacktes = 0;
            var frame = new Uint8Array();
            var audioFrame = new Uint8Array();
            var videoFrameCount = 0;
            while (this.stream.remaining > 0) {
                var header = this.readTSHeader(this.stream);
                if (header.sync_byte != 71) {
                    console.error("ts file data error.");
                    readErr = true;
                    break;
                }
                var startPos = this.stream.remaining;
                if (header.adaption_field_control == 2 || header.adaption_field_control == 3) {
                    var ada = this.readAdaptationField(this.stream);
                    if (ada.error) {
                        console.error("ada read error.");
                        readErr = true;
                        break;
                    }
                }
                if (header.adaption_field_control == 1 || header.adaption_field_control == 3) {
                    if (header.pid == this.videoPID) {
                        var payload = this.stream.readU8Array(184 - (startPos - this.stream.remaining));
                        if (header.payload_unit_start_indicator == 1) {
                            videoFrameCount++;
                            if (frame.length > 0) {
                                this.readVideoFrame(new Bytestream(frame));
                            }
                            frame = new Uint8Array(payload.length);
                            frame.set(payload);
                        } else {
                            var tmp = new Uint8Array(frame.length + payload.length);
                            tmp.set(frame);
                            tmp.set(payload, frame.length);
                            frame = tmp;
                        }
                    } else if (header.pid == this.audioPID) {
                        var payload = this.stream.readU8Array(184 - (startPos - this.stream.remaining));
                        if (header.payload_unit_start_indicator == 1) {
                            if (audioFrame.length > 0) {
                                this.readAudioFrame(new Bytestream(audioFrame));
                            }
                            audioFrame = new Uint8Array(payload.length);
                            audioFrame.set(payload);
                        } else {
                            var tmp = new Uint8Array(audioFrame.length + payload.length);
                            tmp.set(audioFrame);
                            tmp.set(payload, audioFrame.length);
                            audioFrame = tmp;
                        }
                    } else if (header.pid == 0) {
                        var pat = this.readPAT(this.stream);
                    } else if (header.pid == 17) {
                        var std = this.readSDT(this.stream);
                    } else if (header.pid == 4096) {
                        var pmt = this.readPMT(this.stream);
                    }
                }
                var unreadLen = 184 - (startPos - this.stream.remaining);
                if (unreadLen > 0) {
                    var payload = this.stream.readU8Array(unreadLen);
                }
                if (unreadLen < 0) {
                    console.error("read ts error.");
                    readErr = true;
                    break;
                }
                allPacktes++;
            }

            if (readErr) {
                return false;
            }

            if (frame.length > 0) {
                this.readVideoFrame(new Bytestream(frame));
            }

            if (audioFrame.length > 0) {
                this.readAudioFrame(new Bytestream(audioFrame));
            }

            console.info("Parsed stream in " + ((new Date).getTime() - start) + " ms");
            return true;
        }
    };
    return constructor;
})();

var TSPlayer = (function reader() {

    function constructor(stream, useWorkers, workerFile, webgl, width, height, onReady, audioId, videoCanvasId) {
        this.stream = stream;
        this.useWorkers = useWorkers;
        this.pic = 0;
        this.status = 0; // 0 :stoped, 1:playing, 2:paused
        this.currentTime = 0;
        this.width = width || 0;
        this.height = height || 0;
        this.startPic = 0;
        this.startPts = 0;
        this.audioSyncTime = 0;
        this.startTime = 0;
        this.videoWidth = 0;
        this.videoHeight = 0;
        this.audioElement = null;
        this.audioPlayer = null;
        this.audioPlayerEnable = false;
        this.audioPlayerCurrentTime = 0;
        this.videoCanvasId = videoCanvasId;
        if (audioId && !this.audioPlayerEnable) {
            this.audioElement = document.getElementById(audioId);
        }

        this.avc = new Player({
            useWorker: useWorkers,
            workerFile: workerFile || 'Decoder.js',
            webgl: webgl,
            canvasId: videoCanvasId,
            size: {
                width: this.width,
                height: this.height
            }
        });

        this.avc.onPictureDecoded = function (buffer, width, height) {
            if (this.startPts == 0) {
                console.info("first frame decoded. width=" + width + ", height=" + height + ", buf size=" + buffer.length);
                this.videoWidth = width;
                this.videoHeight = height;
                this.startPic = this.pic;
                this.startPts = this.reader.frames[this.startPic].pts;
                if (this.startPts == 0) {
                    this.startPts = 1;
                }
            }
        }.bind(this);

        this.canvas = this.avc.canvas;

        this.readAll(function (readRet) {
            if (!readRet) {
                onReady(false);
                return;
            }

            setTimeout(function decodeFirstFrame() {
                for (var i = 0; i < 3; i++) {
                    if (this.startPts != 0) {
                        break;
                    }
                    this.avc.decode(this.reader.frames[this.pic].data);
                    this.pic++;
                }
                onReady(true);
            }.bind(this), 100);
        }.bind(this));
    }

    constructor.prototype = {
        readAll: function (callback) {
            console.info("TSPlayer::readAll()");
            this.stream.readAll(null, function (buffer) {
                this.reader = new TSReader(new Bytestream(buffer));
                var readRet = this.reader.read();
                this.initAudioPlay();
                console.info("TSPlayer::readAll(), length: " + this.reader.stream.length);
                if (callback) callback(readRet);
            }.bind(this));
        },
        initAudioPlay: function () {
            if (!this.audioPlayerEnable){
                return;
            }

            if (this.audioPlayer && this.audioPlayer.playing) {
                this.audioPlayer.stop();
                this.audioPlayer = null;
            }
            this.audioPlayerCurrentTime = 0;
            var list = new AV.BufferList;
            for(var i=0; i<this.reader.audioFrames.length; i++){
                list.append(new AV.Buffer(this.reader.audioFrames[i].data));
            }
            this.audioPlayer = AV.Player.fromBuffer(list);

            this.audioPlayer.on('progress', function (time) {
                this.audioPlayerCurrentTime = time;
            }.bind(this));

        },
        playAudio: function () {
            if (this.audioElement) {
                this.audioElement.play();
            }
            if (this.audioPlayer) {
                this.audioPlayer.play();
            }
        },
        play: function () {
            if (this.status == 2) {
                this.resume();
                return;
            }
            if (this.status != 0) {
                return;
            }
            this.status = 1;
            this.pic = 0;
            this.startTime = 0;

            if (!reader) {
                this.readAll(this.play.bind(this));
                return;
            }

            this.playAudio();

            this.decodeVideo();

        },
        getAudioCurrentTime: function () {
            if (this.audioElement) {
                return Math.floor(this.audioElement.currentTime * 1000);
            }

            if (this.audioPlayer) {
                return this.audioPlayerCurrentTime;
            }
            return -1;
        },
        decodeVideo: function () {
            this.startTime = (new Date()).getTime();
            setTimeout(function decodeNext() {
                if (this.pic <= this.reader.frames.length - 1 && this.status != 0) {
                    if (this.status == 1) {
                        var audioCurrentTime = this.getAudioCurrentTime();
                        if (audioCurrentTime == 0) {
                            setTimeout(decodeNext.bind(this), 10);
                        } else {
                            if (audioCurrentTime > 0 && (audioCurrentTime < 500 || this.audioSyncTime == 0 || audioCurrentTime - this.audioSyncTime > 1500)) {
                                var p = (new Date()).getTime() - this.startTime;
                                this.startTime -= (audioCurrentTime - p);
                                this.audioSyncTime = audioCurrentTime;
                            }
                            var pts = this.reader.frames[this.pic].pts;
                            var nowTime = (new Date()).getTime();
                            var dx = nowTime - this.startTime;
                            if (dx < pts) {
                                setTimeout(decodeNext.bind(this), pts - dx);
                            } else {
                                this.avc.decode(this.reader.frames[this.pic].data);
                                this.pic++;
                                this.currentTime = pts;
                                setTimeout(decodeNext.bind(this), 0);
                            }
                        }
                    } else if (this.status == 2) {
                        setTimeout(decodeNext.bind(this), 10);
                    }
                } else {
                    this.status = 0;
                    this.pic = 0;
                    this.audioSyncTime = 0;
                    if (this.onended) {
                        this.onended();
                    }
                }
            }.bind(this), 10);
        },
        pause: function () {
            if (this.status != 1) {
                return;
            }
            this.status = 2;
            if (this.audioElement) {
                this.audioElement.pause();
            }
        },
        resume: function () {
            if (this.status != 2) {
                return;
            }
            if (this.audioElement && !this.audioElement.paused) {
                return;
            }
            this.status = 1;
            if (this.audioElement) {
                this.audioElement.play();
            }
        },
        stop: function () {
            if (this.status == 0) {
                return;
            }
            this.status = 0;
            if (this.audioElement) {
                this.audioElement.pause();
                this.audioElement.load();
            }
            if (this.audioPlayer) {
                this.audioPlayer.stop();
                this.initAudioPlay();
            }
            this.audioSyncTime = 0;
        }
    };

    return constructor;
})();
