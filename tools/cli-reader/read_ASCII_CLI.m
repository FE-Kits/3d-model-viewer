function  npoint  = read_ASCII_CLI(filename)
%��ȡ�ļ���cell������
fid=fopen(filename,'r+');%���ļ��в���ȡ�ļ���ʶ��
% a=textscan(fid,'%s');
p=1; %��ʼ��������
while feof(fid)==0 %��ȡÿ�е��ַ������洢��cell������
    tline{p,1}=fgetl(fid);
    p=p+1;
end
fclose(fid);%�ر��ļ���

%��ȡcell�����С�/������ַ��������� npoint()
% point=[];
z=[];
for j=9:(length(tline)-1) %cell����Ԫ�ظ���  24
    p=1; l=1;
    for k=1:numel(tline{j}) %cell����Ԫ���ַ�������
         
         if tline{j,1}(k)=='/' %��������/���󽫺�����ַ�����point��������ά������
            p=k;l=1;
         end
        point(j-8,l)=tline{j,1}(p);
        p=p+1; l=l+1;
    end 
end  %�õ��������а�����/��
point=char(point);  %��double��������char����
point(:,1)=[]; %ɾ��point�����һ�еġ�/��Ԫ��
a=size(point); %�õ��������������������ֱ�Ϊa(1),a(2)
% npoint=[];
for i=1:a(1) %���ַ�������תΪ��������
     npoint{i,:}=sscanf(point(i,:),'%f,');
end 

%����part��dir��num����P1x��P1y��2108/8/15
%��x�������npoint{i��2}��y�������npoint{i��3},z�������npoint{i��4}
for i=1:a(1)
    l=1;k=1;
    if length(npoint{i,1})==1
        npoint{i,2}=npoint{i,1}; 
        z=npoint{i,2};
    else
        for j=4:length(npoint{i,1})
            if mod(j,2)==0
                npoint{i,2}(l)=npoint{i,1}(j);%x����cell{i��2}
                %x(l)=npoint{i,2}(l);
                l=l+1;
            else
                npoint{i,3}(k)=npoint{i,1}(j);%y����cell{i��3}
                %y(k)=npoint{i,3}(k);
                k=k+1;
                npoint{i,4}(k)=z;%z����cell{i��4}
            end
        end 
        npoint{i,4}(1)=[];
        %plot3(npoint{i,2},npoint{i,3},npoint{i,4});%�������������
        %hold on;
    end 
end
end

